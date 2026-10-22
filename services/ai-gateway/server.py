import base64
import copy
import ipaddress
import os
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

SERVICE_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = Path(os.environ["FRONTEND_DIST"]).resolve() if os.getenv("FRONTEND_DIST") else None
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from runtime import encode, business_operation, HttpError, request, upstream, text, configure_telemetry, log_event
from user_client import UserClient
from purchase_sync import PurchaseSync
from auth import connect_mongo, require_role
from admin import routes as admin_routes, settings
from store import Store, cents
import currency_quote
from cart_repository import CartRepository
from events import OrderPublisher
from llm import LLMConfiguration
from llm_config import service_headers, unconfigured, authenticate_service
from catalogue import retrieve
from client_address import client_address
from reviews import Reviews
from chat_history import ChatHistory
from api_models import ChatRequest, CheckoutRequest, CurrencyQuoteRequest, validate
from readiness import gateway_readiness
from product_details import related, require_purchasable, checkout_provenance


def public_order(o):
    return {
        k: v
        for k, v in o.items()
        if k not in ("session", "key", "shipmentEvent", "userId", "customerSyncedAt", "reconciliationAudit")
    }


def expectation(o):
    return {
        "orderId": o["razorpayOrderId"],
        "amount": o.get("amount", cents(o["total"])),
        "currency": o["currency"],
    }


class Gateway:
    def __init__(self, db, store):
        self.chat_history = ChatHistory(db)
        self.db = db
        self.store = store
        self.auth = UserClient()
        demo_db = None
        if os.getenv('DEMO_MONGODB_URL'):
            from pymongo import MongoClient
            name = os.getenv('DEMO_REVIEWS_DATABASE', 'roboshop_demo_merchant20')
            if not re.fullmatch(r'roboshop_demo_[a-z0-9_]{1,40}', name):
                raise RuntimeError('Demo reviews require an isolated roboshop_demo_ database.')
            self.demo_client = MongoClient(os.environ['DEMO_MONGODB_URL'], serverSelectionTimeoutMS=3000, socketTimeoutMS=5000)
            demo_db = self.demo_client[name]
        self.reviews = Reviews(db, demo_db, verification=self.auth.verified_purchase)
        configure_telemetry("ai-gateway")
        self.customers = PurchaseSync(self.auth, store)
        self.limits = {}
        self.limit_lock = threading.Lock()
        # Leave HTTP workers free for the agent's authoritative revision reads.
        self.chat_slots = threading.BoundedSemaphore(2)
        self.origin = os.getenv(
            "PUBLIC_ORIGIN", f"http://localhost:{os.getenv('PORT','3000')}"
        )
        self.urls = {
            k: os.getenv(env, default)
            for k, env, default in [
                ("catalogue", "CATALOGUE_URL", os.getenv("INGESTION_URL", "http://127.0.0.1:4108")),
                ("recommendations", "RECOMMENDATION_URL", os.getenv("CATALOGUE_URL", "http://127.0.0.1:4108")),
                ("agent", "AGENT_URL", "http://127.0.0.1:4103"),
                ("sre", "SRE_URL", "http://127.0.0.1:4104"),
                ("payment", "PAYMENT_URL", "http://127.0.0.1:4105"),
                ("shipping", "SHIPPING_URL", "http://127.0.0.1:4106"),
            ]
        }

        self.llm = LLMConfiguration(db, self.urls["agent"])

    def limit(self, req, ai=False):
        with self.limit_lock:
            now = time.time()
            self.limits = {k: v for k, v in self.limits.items() if v[1] >= now}
            key = (client_address(req), ai)
            count, until = self.limits.get(key, (0, now + 60))
            self.limits[key] = (count + 1, until)
            if count + 1 > (10 if ai else 300):
                raise HttpError(429, "Too many requests. Please wait a minute.")

    def session(self, req):
        old = req.cookie("rs_session", r"[a-f0-9-]{36}")
        # Per-cart gates never hold the global ledger lock across Redis I/O.
        with self.store.cart_lock(old):
            with self.store.lock:
                entry = self.store.session_entry(old)
                owns_old = (entry and (entry["expires"] > time.time() * 1000 or self.store.pending(old))
                            and entry.get("userId") in (None, req.user["id"] if req.user else None))
            if owns_old:
                self.store.sync_cart(old)
            with self.store.lock:
                id = self.store.session(old, req.user["id"] if req.user else None)
        self.store.sync_cart(id)
        if id != old:
            req.set_cookie("rs_session", id, 604800)
        return id

    def catalogue(self, timeout=12):
        return request(self.urls["catalogue"] + "/api/products", timeout=timeout)["products"]

    def products(self):
        products = self.catalogue()
        with self.store.lock:
            return [
                {**p, "instock": self.store.available(p)}
                for p in products
                if not p.get("archived")
            ]

    def payment(self, path, data=None):
        return upstream(
            self.urls["payment"] + "/api/payment/" + path,
            data,
            {"x-payment-service-token": os.getenv("PAYMENT_SERVICE_TOKEN", "")},
        )

    def feature_unavailable(self, feature):
        return {"code": "feature-unavailable", "feature": feature, "available": False,
                "error": f"{feature.capitalize()} is temporarily unavailable. Please try again later.",
                "products": []}, 503, []

    def order_snapshot(self, id, session=None):
        with self.store.lock:
            return copy.deepcopy(self.store.payment_order(id, session))

    def provider_context(self, order):
        if order.get("paymentMode") not in ("test", "live") or not re.fullmatch(r"rzp_" + order["paymentMode"] + r"_[A-Za-z0-9]+", order.get("paymentKeyId") or ""):
            raise HttpError(409, "Original payment environment is not recorded. Operator reconciliation required.")
        return {"mode": order["paymentMode"], "keyId": order.get("paymentKeyId")}

    def reconcile(self, order):
        order = self.order_snapshot(order["id"])
        if order["status"] == "payment_review":
            result = self.payment("recover", {
                "receipt": order["id"], "amount": order.get("amount", cents(order["total"])),
                "currency": order["currency"], **self.provider_context(order),
            })
            if result.get("found"):
                with self.store.lock:
                    order = copy.deepcopy(self.store.attach_payment(order["id"], result, order.get("revision", 0)))
            else:
                return self.order_snapshot(order["id"])
        if order["status"] != "payment_pending":
            return order
        result = self.payment("reconcile", expectation(order) | self.provider_context(order))
        with self.store.lock:
            if result.get("verified"):
                self.store.mark_paid(order["id"], result, order.get("revision", 0))
            updated = copy.deepcopy(self.store.payment_order(order["id"]))
        if result.get("verified"):
            log_event("checkout_payment_captured", orderId=order["id"], state="paid")
        return updated

    def checkout(self, id, key, quote_token=None):
        with self.store.lock:
            order = copy.deepcopy(self.store.existing_payment(id, key))
            version = self.store.cart_version(id)
        if order:
            log_event("checkout_reused", orderId=order["id"], state=order["status"])
        if order and order["status"] == "paid":
            return {"order": public_order(order)}
        created = False
        if not order:
            # Coordinate admin inventory edits without holding the ledger lock.
            with self.store.catalogue_lock:
                with self.store.lock:
                    order = copy.deepcopy(self.store.existing_payment(id, key))
                if not order:
                    if not settings(self.db)["checkoutEnabled"]:
                        raise HttpError(503, "New checkouts are temporarily paused. Existing payments can still be verified.")
                    products = self.catalogue()
                    with self.store.lock:
                        for item in self.store.cart(id, products)["items"]:
                            require_purchasable(item)
                    config = self.payment("config")
                    if not config["enabled"]:
                        raise HttpError(503, config.get("message", "Payments unavailable."))
                    order, created = self.store.reserve_payment(
                        id, key, products, config.get("mode", "unknown"), config.get("keyId"), version, quote_token=quote_token
                    )
        if created:
            log_event("checkout_reserved", orderId=order["id"], state=order["status"])
            try:
                provider = self.payment("orders", {
                    "amount": order.get("amount", cents(order["total"])), "currency": order["currency"],
                    "receipt": order["id"], "demo": order["demo"],
                    "inventoryProvenance": order["inventoryProvenance"], **self.provider_context(order),
                })
                with self.store.lock:
                    order = copy.deepcopy(self.store.attach_payment(order["id"], provider, order["revision"]))
                log_event("checkout_provider_order_attached", orderId=order["id"], state=order["status"])
            except Exception:
                with self.store.lock:
                    self.store.review_payment(order["id"], order["revision"])
                log_event("checkout_reconciliation_required", "WARN", orderId=order["id"], reason="provider_response_ambiguous")
                raise
        else:
            order = self.reconcile(order)
        if order["status"] == "paid":
            return {"order": public_order(order)}
        if order["status"] != "payment_pending":
            raise HttpError(409, "Payment setup needs reconciliation. Check payment status for order " + order["id"] + ".")
        # Old live orders may predate demo classification. Reconcile captures, but
        # never offer a new live Checkout session for a known demo snapshot.
        checkout_provenance(order["items"], order["paymentMode"])
        config = self.payment("config", self.provider_context(order))
        if (not config["enabled"] or config["mode"] != order["paymentMode"] or
                (order.get("paymentKeyId") and config["keyId"] != order["paymentKeyId"])):
            raise HttpError(409, "Payment configuration changed. Restore the original payment account to resume this order.")
        return {"order": public_order(order), "checkout": {
            "key": order.get("paymentKeyId") or config["keyId"], "order_id": order["razorpayOrderId"],
            "amount": order.get("amount", cents(order["total"])), "currency": order["currency"],
            "name": "RoboShop", "description": ("Demo checkout — no real money charged · " if order["paymentMode"] == "test" else "Live purchase · ") + order["id"],
        }, "mode": order["paymentMode"]}, 201, []

    def handle(self, req):
        path, method = req.path, req.method
        if path == "/internal/llm/config" and method == "GET":
            authenticate_service(req.headers)
            active = self.llm.current()
            return {"config": active["config"], "revision": active["revision"]}
        if path == "/api/payments/webhook" and method == "POST":
            event = self.payment(
                "webhook-check",
                {
                    "raw": base64.b64encode(req.raw(65536)).decode(),
                    "signature": req.headers.get("x-razorpay-signature"),
                },
            )
            if not event.get("ignored"):
                if event.get("mode") not in ("test", "live") or not event.get("keyId"):
                    raise HttpError(503, "Webhook environment could not be established.")
                with self.store.lock:
                    order = self.store.find_payment(event.get("orderId"), event.get("mode"), event.get("keyId"))
                if not order:
                    provider = self.payment("lookup", {"orderId": event.get("orderId"), "mode": event.get("mode"), "keyId": event.get("keyId")})
                    with self.store.lock:
                        try:
                            candidate = self.store.payment_order(provider.get("receipt"))
                        except HttpError as error:
                            if error.status != 404:
                                raise
                            candidate = None
                        if candidate:
                            order = copy.deepcopy(self.store.attach_payment(candidate["id"], provider, candidate.get("revision", 0)))
                if order:
                    self.reconcile(order)
            return {"received": True}
        if not path.startswith("/api/"):
            return self.static(req)
        if path == "/api/ready" and method == "GET":
            return gateway_readiness(self)
        self.limit(req)
        if method not in ("GET", "HEAD"):
            if req.headers.get("origin") and req.headers["origin"] != self.origin:
                raise HttpError(403, "Origin not allowed.")
            if req.headers.get("sec-fetch-site") == "cross-site":
                raise HttpError(403, "Cross-site requests are not allowed.")
        if path.startswith('/api/auth/') or path.startswith('/api/account/') or path == '/api/admin/users' or path.startswith('/api/admin/users/'):
            result = self.auth.forward(req)
            body, status, _ = result
            if method == 'POST' and path in ('/api/auth/login', '/api/auth/register', '/api/auth/mfa/verify') and body.get('user'):
                req.user = body['user']
                cart_id = self.session(req)
                with self.store.lock:
                    shipping = self.store.session_entry(cart_id).get('shipping')
                if shipping:
                    self.customers.save_address(req.user['id'], shipping)
            return result
        token = req.cookie('rs_auth', r'[a-f0-9]{64}')
        req.user = self.auth.current(token)
        if method == "GET" and (path == "/api/catalogue/categories" or re.fullmatch(r"/api/catalogue/(?:product|category|search)/[^/]+", path)):
            result = upstream(self.urls["catalogue"] + path)
            def available(row):
                return {**row, "instock": self.store.available(row)}
            with self.store.lock:
                if isinstance(result, list):
                    return [available(row) if isinstance(row, dict) and "sku" in row else row for row in result]
                return available(result) if isinstance(result, dict) and "sku" in result else result
        match = re.fullmatch(
            r"/api/products/([a-z0-9][a-z0-9-]{0,99})(/reviews(?:/mine)?)?", path
        )
        if match:
            product = next(
                (
                    p
                    for p in self.products()
                    if p.get("slug", p["sku"].lower()) == match[1]
                ),
                None,
            )
            if not product:
                raise HttpError(404, "Product not found.")
            if not match[2] and method == "GET":
                return {
                    "product": product,
                    "related": related(product, self.products()),
                }
            if match[2] == "/reviews/mine" and method == "GET":
                require_role(req.user)
                row = self.db.reviews.find_one(
                    {
                        "productId": product["sku"],
                        "authorId": req.user["id"],
                        "synthetic": False,
                    }
                )
                return {"review": self.reviews.public(row) if row else None}
            if match[2] == "/reviews":
                if method == "GET":
                    return self.reviews.listing(product["sku"], req.query)
                if method in ("POST", "PUT", "DELETE"):
                    require_role(req.user)
                    self.auth.limit("review:" + req.user["id"])
                    return self.reviews.write(
                        product["sku"],
                        req.user,
                        method,
                        req.body() if method != "DELETE" else None,
                    )
        if path == "/api/admin/reviews" and method == "GET":
            require_role(req.user, ("admin", "superadmin"))
            return self.reviews.listing(None, req.query, admin=True)
        match = re.fullmatch(r"/api/admin/reviews/([A-Za-z0-9:_-]{1,160})", path)
        if match and method == "PATCH":
            return self.reviews.moderate(match[1], req.user, req.body())
        if path.startswith("/api/admin/"):
            if (
                method not in ("GET", "HEAD")
                and req.headers.get("origin") != self.origin
            ):
                raise HttpError(403, "Origin not allowed.")
            match = re.fullmatch(r"/api/admin/test-orders/([a-f0-9-]{36})/reconcile", path)
            if match and method == "POST":
                actor = require_role(req.user, ["superadmin"])
                data = req.body()
                if set(data) != {"reason", "revision"} or not isinstance(data["reason"], str) or not 10 <= len(data["reason"].strip()) <= 500 or type(data["revision"]) is not int:
                    raise HttpError(400, "Provide revision and a 10–500 character reconciliation reason.")
                with self.store.lock:
                    order = self.store.payment_order(match[1])
                    if order.get("paymentMode") != "test" or order.get("revision", 0) != data["revision"]:
                        raise HttpError(409, "Only current test orders may use this procedure. Refresh first.")
                    self.store.audit_reconciliation(order["id"], actor["id"], data["reason"].strip(), "requested")
                    snapshot = copy.deepcopy(order)
                try:
                    result = self.reconcile(snapshot)
                except Exception:
                    with self.store.lock:
                        self.store.audit_reconciliation(snapshot["id"], actor["id"], "Provider check failed; reservation retained.", "unavailable")
                    raise
                with self.store.lock:
                    self.store.audit_reconciliation(snapshot["id"], actor["id"], "Read-only provider reconciliation; no stock release.", result["status"])
                    final = copy.deepcopy(self.store.payment_order(snapshot["id"]))
                    return public_order(final) | {"reconciliationAudit": final["reconciliationAudit"]}
            if path == "/api/admin/test-orders" and method == "GET":
                require_role(req.user, ["superadmin"])
                with self.store.lock:
                    return {"orders": [{k: copy.deepcopy(o.get(k)) for k in ("id", "status", "revision", "paymentMode", "demo", "reconciliationAudit")} for o in self.store.orders("test")][-100:]}
            if path == "/api/admin/llm" or path.startswith("/api/admin/llm/"):
                self.limit(req, True)
                return self.llm.routes(req)
            with self.store.catalogue_lock:
                return admin_routes(req, self.db, self.auth, self.store)
        if path == "/api/settings" and method == "GET":
            return settings(self.db)
        if path.startswith("/api/payments/") and path != "/api/payments/config":
            require_role(req.user)
        if path.startswith("/api/shipping/"):
            quote = path == "/api/shipping/quote" and method == "POST"
            if not quote and not (
                method == "GET"
                and path in ("/api/shipping/countries", "/api/shipping/cities")
            ):
                return
            data = req.body() if quote else None
            id = self.session(req) if quote else None
            if quote:
                with self.store.lock:
                    if self.store.pending(id):
                        raise HttpError(
                            409, "A payment is pending. Shipping cannot be changed."
                        )
            if quote:
                products = self.catalogue()
                with self.store.lock:
                    data = {**data, "currency": self.store.cart(id, products)["currency"]}
            result = upstream(
                self.urls["shipping"]
                + path
                + ("?" + urlencode(req.query) if req.query else ""),
                data,
                timeout=5,
            )
            if not quote:
                return result
            products = self.catalogue()
            if req.user:
                self.customers.save_address(req.user["id"], result)
            return self.store.set_shipping(id, result, products)
        if path == "/api/status" and method == "GET":
            return {
                "assistantMode": (
                    "ai"
                    if self.llm.current()["config"]["provider"] != "none"
                    else "not-configured"
                ),
                "checkoutMode": "razorpay",
            }
        if path == "/api/payments/config" and method == "GET":
            return self.payment("config") | {"currencies": currency_quote.currencies()}
        if path == "/api/payments/quote" and method == "POST":
            id = self.session(req)
            data = req.body()
            validate(CurrencyQuoteRequest, data)
            products = self.catalogue()
            with self.store.lock:
                if self.store.pending(id):
                    raise HttpError(409, "A pending payment already has a fixed currency and amount.")
                cart = copy.deepcopy(self.store.cart(id, products))
                revision = self.store.cart_version(id)
            config = self.payment("config")
            if not config["enabled"]:
                raise HttpError(503, "Payments are unavailable.")
            return currency_quote.issue(id, cart, revision, data["currency"], config.get("mode"))
        if (
            path in ("/api/payments/current", "/api/payments/status")
            and method == "GET"
        ):
            id = self.session(req)
            with self.store.lock:
                order = (
                    self.store.pending(id)
                    if path.endswith("/current")
                    else self.store.payment_order(req.query.get("orderId"), id)
                )
            result = public_order(self.reconcile(order)) if order else None
            return {"order": result} if path.endswith("/current") else result
        if path == "/api/payments/orders" and method == "POST":
            data = req.body()
            validate(CheckoutRequest, data)
            id = self.session(req)
            return self.checkout(id, req.headers.get("idempotency-key"), data.get("quoteToken"))
        if path == "/api/payments/verify" and method == "POST":
            data = req.body()
            id = self.session(req)
            order = self.order_snapshot(data.get("orderId"), id)
            if not order.get("razorpayOrderId"):
                raise HttpError(409, "Payment setup needs reconciliation before verification.")
            if data.get("razorpay_order_id") != order["razorpayOrderId"]:
                raise HttpError(400, "Order ID mismatch.")
            result = self.payment(
                "verify",
                expectation(order) | self.provider_context(order)
                | {
                    "paymentId": data.get("razorpay_payment_id"),
                    "signature": data.get("razorpay_signature"),
                },
            )
            with self.store.lock:
                updated = public_order(
                    self.store.mark_paid(order["id"], result, order.get("revision", 0))
                    if result.get("verified")
                    else self.store.payment_order(order["id"])
                )
            if result.get("verified"):
                log_event("checkout_payment_captured", orderId=order["id"], state="paid")
            return updated
        if path == "/api/products" and method == "GET":
            return {
                "products": self.products(),
                "checkoutCurrency": "INR",
                "currencyPolicy": "Each listing retains its source currency and price type. Reference prices are not merchant offers. Historical orders retain their original currency.",
            }
        if path == "/api/compare" and method == "GET":
            skus = req.query.get("skus", "").split(",")
            if (
                not 2 <= len(skus) <= 4
                or len(set(skus)) != len(skus)
                or any(not re.fullmatch("[A-Za-z0-9_-]{1,64}", s) for s in skus)
            ):
                raise HttpError(400, "Compare 2–4 distinct valid SKUs.")
            products = {p["sku"]: p for p in self.products()}
            if any(s not in products for s in skus):
                raise HttpError(404, "Product not found.")
            return {
                "products": [products[s] for s in skus],
                "currency": (
                    next(iter({products[s].get("currency", "EUR") for s in skus}))
                    if len({products[s].get("currency", "EUR") for s in skus}) == 1
                    else None
                ),
                "priceComparisonPolicy": "Compare amounts only within the same currency, price type and collection. Reference prices are not merchant offers.",
                "lowestPrice": (
                    min(products[s]["price"] for s in skus)
                    if len({products[s].get("currency", "EUR") for s in skus}) == 1
                    and len({products[s].get("priceType", "sale") for s in skus}) == 1
                    and len({products[s].get("collection", "merchant") for s in skus}) == 1
                    and all(products[s].get("priceType") != "on-request" for s in skus)
                    else None
                ),
            }
        if path == "/api/recommendations/personalized" and method == "GET":
            require_role(req.user)
            id = self.session(req)
            products = self.products()
            with self.store.lock:
                cart = self.store.cart(id, products)
            excluded = {p["sku"] for p in cart["items"]}
            categories = list(
                dict.fromkeys(c for p in cart["items"] for c in p.get("categories", []))
            )
            picks = retrieve(
                [p for p in products if p["sku"] not in excluded],
                " ".join(categories)[:1000],
            )
            return {
                "products": picks,
                "basis": "cart-categories" if categories else "in-stock-catalogue",
                "currency": cart.get("currency", "INR"),
            }
        if path == "/api/recommendations" and method == "GET":
            params = dict(req.query)
            products = self.catalogue()
            with self.store.lock:
                params["exclude"] = ",".join(
                    [params.get("exclude", "")]
                    + [p["sku"] for p in products if self.store.available(p) < 1]
                )
            try:
                result = request(
                    self.urls["recommendations"]
                    + "/api/recommendations?"
                    + urlencode(params), timeout=3
                )
            except HttpError as error:
                if error.status < 500:
                    raise
                return self.feature_unavailable("recommendations")
            with self.store.lock:
                result["products"] = [
                    {**p, "instock": self.store.available(p)}
                    for p in result["products"]
                    if self.store.available(p) > 0
                ]
            return result
        if path == "/api/chat/history" and method == "GET":
            authenticate_service(req.headers)
            user = require_role(req.user)
            return {"turns": self.chat_history.read(user["id"])}
        if path == "/api/chat" and method == "POST":
            authenticate_service(req.headers)
            user = require_role(req.user)
            self.limit(req, True)
            data = req.body()
            message = text(validate(ChatRequest, data).message)
            previous = self.chat_history.read(user["id"])
            active = self.llm.current()
            if active["config"]["provider"] == "none":
                log_event("ai_not_configured", reason="superadmin_configuration_required")
                return unconfigured()
            products = self.catalogue(timeout=2)
            with self.store.lock:
                unavailable = [
                    p["sku"] for p in products if self.store.available(p) < 1
                ]
            if not self.chat_slots.acquire(blocking=False):
                return self.feature_unavailable("finder")
            try:
                payload = {
                    "message": message,
                    "history": self.chat_history.context(previous),
                    "unavailableSkus": unavailable,
                    "config": active["config"],
                    "revision": active["revision"],
                }
                # JSON escaping (especially non-ASCII text) also counts toward
                # the existing internal body limit. Never trim the new question.
                while len(encode(payload)) > 16384 and payload["history"]:
                    payload["history"].pop(0)
                result = request(
                    self.urls["agent"] + "/internal/chat",
                    payload,
                    service_headers(),
                    timeout=18,
                )
            except HttpError as error:
                if error.status < 500:
                    raise
                return self.feature_unavailable("finder")
            finally:
                self.chat_slots.release()
            if result.get("mode") == "provider-unavailable":
                return self.feature_unavailable("finder")
            with self.store.lock:
                result["products"] = [
                    {**p, "instock": self.store.available(p)}
                    for p in result["products"]
                    if self.store.available(p) > 0
                ]
            self.chat_history.save(user["id"], message, result)
            return result
        if path == "/api/ops" and method == "GET":
            try:
                return request(self.urls["sre"] + "/api/ops", timeout=3)
            except HttpError:
                return self.feature_unavailable("diagnostics")
        if path == "/api/cart" and method in ("GET", "POST"):
            id = self.session(req)
            products = self.catalogue()
            data = req.body() if method == "POST" else None
            if data is not None:
                return self.store.update(id, data.get("sku"), data.get("quantity"), products)
            with self.store.lock:
                return self.store.cart(id, products)
        if path == "/api/orders" and method == "POST":
            raise HttpError(410, "Demo orders are disabled. Use Razorpay checkout.")

    def static(self, req):
        if STATIC_ROOT is None:
            return None
        if req.method not in ("GET", "HEAD"):
            return
        path = "/admin.html" if req.path == "/admin" else req.path
        if path in ("/account", "/account/"):
            path = "/profile.html"
        if path in ("/cart", "/cart/", "/checkout", "/checkout/"):
            path = "/checkout.html"
        if re.fullmatch(r"/products/[a-z0-9][a-z0-9-]{0,99}", path):
            path = "/product.html"
        if path in (
            "/",
            "/index.html",
            "/admin.html",
            "/product.html",
            "/checkout.html",
            "/profile.html",
            "/profile.js",
            "/checkout.js",
            "/product.js",
            "/paths.js",
            "/challenge.js",
            "/app.js",
            "/account.js",
            "/admin.js",
            "/styles.css",
        ):
            file = (
                STATIC_ROOT
                / ("index.html" if path == "/" else path[1:])
            )
        elif re.fullmatch(r"/product-media/[a-z0-9-]+\.(?:jpg|png)", path):
            file = STATIC_ROOT / path[1:]
        elif re.fullmatch(r"/illustrations/(robot|kit|component|accessory)\.svg", path):
            file = STATIC_ROOT / path[1:]
        elif re.fullmatch("/images/[a-zA-Z0-9_-]+\.png", path):
            file = STATIC_ROOT / path[1:]
        else:
            return
        if file.is_file():
            return (
                file.read_bytes(),
                200,
                [
                    (
                        "Content-Type",
                        {
                            ".html": "text/html; charset=utf-8",
                            ".js": "text/javascript; charset=utf-8",
                            ".css": "text/css; charset=utf-8",
                            ".png": "image/png",
                            ".jpg": "image/jpeg",
                            ".svg": "image/svg+xml",
                        }[file.suffix],
                    ),
                    (
                        "Cache-Control",
                        "public, max-age=3600" if file.suffix == ".png" else "no-cache",
                    ),
                ],
            )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("asgi_app:create_app", factory=True, host=os.getenv("HOST", "0.0.0.0"),
                port=int(os.getenv("PORT", "3000")), workers=1, proxy_headers=False,
                limit_concurrency=100, timeout_keep_alive=5, access_log=False)
