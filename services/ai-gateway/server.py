import base64
import ipaddress
import os
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/python-common"))
from runtime import HttpError, serve, request, upstream, text, configure_telemetry
from customers import Customers
from auth import Auth, connect_mongo, public_user, require_role
from admin import routes as admin_routes, settings
from store import Store, cents
from cart_repository import CartRepository
from events import OrderPublisher
from llm import LLMConfiguration
from llm_config import service_headers, unconfigured
from catalogue import retrieve
from registration import Registration, client_address
from reviews import Reviews
from product_details import related, require_purchasable


def public_order(o):
    return {
        k: v
        for k, v in o.items()
        if k not in ("session", "key", "shipmentEvent", "userId", "customerSyncedAt")
    }


def expectation(o):
    return {
        "orderId": o["razorpayOrderId"],
        "amount": cents(o["total"]),
        "currency": o["currency"],
    }


class Gateway:
    def __init__(self, db, store):
        self.db = db
        self.store = store
        self.auth = Auth(db)
        self.auth.initialize()
        self.registration = Registration(db)
        demo_db = None
        if os.getenv('DEMO_MONGODB_URL'):
            from pymongo import MongoClient
            name = os.getenv('DEMO_REVIEWS_DATABASE', 'robotshop_demo_merchant20')
            if not re.fullmatch(r'robotshop_demo_[a-z0-9_]{1,40}', name):
                raise RuntimeError('Demo reviews require an isolated robotshop_demo_ database.')
            self.demo_client = MongoClient(os.environ['DEMO_MONGODB_URL'], serverSelectionTimeoutMS=3000, socketTimeoutMS=5000)
            demo_db = self.demo_client[name]
        self.reviews = Reviews(db, demo_db)
        configure_telemetry("ai-gateway")
        self.customers = Customers(db, store)
        self.limits = {}
        self.limit_lock = threading.Lock()
        self.origin = os.getenv(
            "PUBLIC_ORIGIN", f"http://localhost:{os.getenv('PORT','3000')}"
        )
        self.urls = {
            k: os.getenv(env, default)
            for k, env, default in [
                ("catalogue", "CATALOGUE_URL", os.getenv("INGESTION_URL", "http://127.0.0.1:4108")),
                ("recommendations", "RECOMMENDATION_URL", "http://127.0.0.1:4102"),
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
        with self.store.lock:
            if old in self.store.state["sessions"]:
                self.store.sync_cart(old)
            id = self.store.session(old, req.user["id"] if req.user else None)
            self.store.sync_cart(id)
        if id != old:
            req.set_cookie("rs_session", id, 604800)
        return id

    def catalogue(self):
        return request(self.urls["catalogue"] + "/api/products")["products"]

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

    def reconcile(self, order):
        if order["status"] != "payment_pending":
            return order
        result = self.payment("reconcile", expectation(order))
        with self.store.lock:
            return (
                self.store.mark_paid(order["id"], result)
                if result.get("verified")
                else order
            )

    def handle(self, req):
        path, method = req.path, req.method
        if path == "/api/payments/webhook" and method == "POST":
            event = self.payment(
                "webhook-check",
                {
                    "raw": base64.b64encode(req.raw(65536)).decode(),
                    "signature": req.headers.get("x-razorpay-signature"),
                },
            )
            if not event.get("ignored"):
                with self.store.lock:
                    order = next(
                        (
                            o
                            for o in self.store.state["orders"]
                            if o.get("razorpayOrderId") == event.get("orderId")
                        ),
                        None,
                    )
                if order:
                    self.reconcile(order)
            return {"received": True}
        if not path.startswith("/api/"):
            return self.static(req)
        self.limit(req)
        if method not in ("GET", "HEAD"):
            if req.headers.get("origin") and req.headers["origin"] != self.origin:
                raise HttpError(403, "Origin not allowed.")
            if req.headers.get("sec-fetch-site") == "cross-site":
                raise HttpError(403, "Cross-site requests are not allowed.")
        token = req.cookie("rs_auth", r"[a-f0-9]{64}")
        req.user = self.auth.current(token)
        if path == "/api/auth/challenge" and method == "GET":
            return self.registration.public()
        if path == "/api/auth/me" and method == "GET":
            return {"user": req.user}
        if (
            path in ("/api/auth/register", "/api/auth/login", "/api/auth/logout")
            and method == "POST"
        ):
            if req.headers.get("origin") != self.origin:
                raise HttpError(403, "Origin not allowed.")
            if path.endswith("/logout"):
                self.auth.logout(token)
                req.set_cookie("rs_auth", "", 0)
                req.set_cookie("rs_session", "", 0)
                return {"loggedOut": True}
            self.auth.limit(client_address(req))
            data = req.body()
            if path.endswith("/register"):
                self.registration.check(data, client_address(req))
            user = (
                self.auth.register(data)
                if path.endswith("/register")
                else self.auth.login(data)
            )
            self.customers.record_login(
                user["_id"],
                client_address(req),
                req.headers.get("user-agent", ""),
                registration=path.endswith("/register"),
            )
            new = self.auth.issue(user)
            self.auth.logout(token)
            req.set_cookie("rs_auth", new, 28800)
            req.user = public_user(user)
            cart_id = self.session(req)
            with self.store.lock:
                shipping = self.store.state["sessions"][cart_id].get("shipping")
            if shipping:
                self.customers.save_address(req.user["id"], shipping)
            return {"user": req.user}, 201 if path.endswith("/register") else 200, []
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
        if path.startswith("/api/account/"):
            require_role(req.user)
            if method != "GET":
                return
            if path == "/api/account/profile":
                return self.customers.profile(req.user["id"])
            if path == "/api/account/purchases":
                return self.customers.purchases(
                    req.user["id"], req.query.get("cursor", "")
                )
            if path == "/api/account/activity":
                return self.customers.activity(req.user["id"])
            return
        customer = re.fullmatch(
            r"/api/admin/users/([a-f0-9-]{36})/(profile|purchases|activity)", path
        )
        if customer and method == "GET":
            require_role(req.user, ["superadmin"])
            if not self.db.users.find_one({"_id": customer[1]}, {"_id": 1}):
                raise HttpError(404, "User not found.")
            if customer[2] == "profile":
                return self.customers.profile(customer[1])
            if customer[2] == "activity":
                return self.customers.activity(customer[1])
            return self.customers.purchases(customer[1], req.query.get("cursor", ""))
        if path.startswith("/api/admin/"):
            if (
                method not in ("GET", "HEAD")
                and req.headers.get("origin") != self.origin
            ):
                raise HttpError(403, "Origin not allowed.")
            if path == "/api/admin/llm" or path.startswith("/api/admin/llm/"):
                self.limit(req, True)
                return self.llm.routes(req)
            with self.store.lock:
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
            with self.store.lock:
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
            return self.payment("config")
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
            req.body()
            id = self.session(req)
            with self.store.lock:
                previous = self.store.pending(id)
                if not settings(self.db)["checkoutEnabled"] and not previous:
                    raise HttpError(
                        503,
                        "New checkouts are temporarily paused. Existing payments can still be verified.",
                    )
                for item in self.store.cart(id, self.catalogue())["items"]:
                    require_purchasable(item)
                config = self.payment("config")
                if not config["enabled"]:
                    raise HttpError(503, config.get("message", "Payments unavailable."))
                order = self.store.begin_payment(
                    id,
                    req.headers.get("idempotency-key"),
                    self.catalogue(),
                    config.get("mode", "unknown"),
                )
                if order["status"] == "paid":
                    return {"order": public_order(order)}
                if order["status"] == "payment_review" or (
                    previous and order["status"] == "creating"
                ):
                    raise HttpError(
                        409,
                        "Payment setup needs reconciliation. Contact the store with order "
                        + order["id"]
                        + ".",
                    )
                if order["status"] == "creating":
                    try:
                        order = self.store.attach_payment(
                            order["id"],
                            self.payment(
                                "orders",
                                {
                                    "amount": cents(order["total"]),
                                    "currency": order["currency"],
                                    "receipt": order["id"],
                                },
                            ),
                        )
                    except Exception:
                        self.store.review_payment(order["id"])
                        raise
                return (
                    {
                        "order": public_order(order),
                        "checkout": {
                            "key": config["keyId"],
                            "order_id": order["razorpayOrderId"],
                            "amount": cents(order["total"]),
                            "currency": order["currency"],
                            "name": "RobotShop",
                            "description": "Order " + order["id"],
                        },
                        "mode": config["mode"],
                    },
                    201,
                    [],
                )
        if path == "/api/payments/verify" and method == "POST":
            data = req.body()
            id = self.session(req)
            with self.store.lock:
                order = self.store.payment_order(data.get("orderId"), id)
            if data.get("razorpay_order_id") != order["razorpayOrderId"]:
                raise HttpError(400, "Order ID mismatch.")
            result = self.payment(
                "verify",
                expectation(order)
                | {
                    "paymentId": data.get("razorpay_payment_id"),
                    "signature": data.get("razorpay_signature"),
                },
            )
            with self.store.lock:
                return public_order(
                    self.store.mark_paid(order["id"], result)
                    if result.get("verified")
                    else order
                )
        if path == "/api/ready" and method == "GET":
            try:
                self.db.command({"ping": 1})
            except Exception:
                raise HttpError(503, "Account database unavailable.")
            result = request(self.urls["sre"] + "/api/ops")
            return result, 200 if result["status"] == "healthy" else 503, []
        if path == "/api/products" and method == "GET":
            return {
                "products": self.products(),
                "checkoutCurrency": "EUR",
                "currencyPolicy": "Reference prices retain source currency. Only sale-priced EUR live inventory is purchasable.",
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
                "lowestPrice": (
                    min(products[s]["price"] for s in skus)
                    if len({products[s].get("currency", "EUR") for s in skus}) == 1
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
                dict.fromkeys(c for p in cart["items"] for c in p["categories"])
            )
            picks = retrieve(
                [p for p in products if p["sku"] not in excluded],
                " ".join(categories)[:1000],
            )
            return {
                "products": picks,
                "basis": "cart-categories" if categories else "in-stock-catalogue",
                "currency": "EUR",
            }
        if path == "/api/recommendations" and method == "GET":
            params = dict(req.query)
            products = self.catalogue()
            with self.store.lock:
                params["exclude"] = ",".join(
                    [params.get("exclude", "")]
                    + [p["sku"] for p in products if self.store.available(p) < 1]
                )
            result = request(
                self.urls["recommendations"]
                + "/api/recommendations?"
                + urlencode(params)
            )
            with self.store.lock:
                result["products"] = [
                    {**p, "instock": self.store.available(p)}
                    for p in result["products"]
                    if self.store.available(p) > 0
                ]
            return result
        if path == "/api/chat" and method == "POST":
            self.limit(req, True)
            data = req.body()
            if set(data) != {"message"}:
                raise HttpError(400, "Only message is accepted for chat.")
            message = text(data.get("message"))
            active = self.llm.current()
            if active["config"]["provider"] == "none":
                return unconfigured()
            products = self.catalogue()
            with self.store.lock:
                unavailable = [
                    p["sku"] for p in products if self.store.available(p) < 1
                ]
            result = request(
                self.urls["agent"] + "/internal/chat",
                {
                    "message": message,
                    "unavailableSkus": unavailable,
                    "config": active["config"],
                    "revision": active["revision"],
                },
                service_headers(),
                timeout=20,
            )
            with self.store.lock:
                result["products"] = [
                    {**p, "instock": self.store.available(p)}
                    for p in result["products"]
                    if self.store.available(p) > 0
                ]
            return result
        if path == "/api/ops" and method == "GET":
            return request(self.urls["sre"] + "/api/ops")
        if path == "/api/cart" and method in ("GET", "POST"):
            id = self.session(req)
            products = self.catalogue()
            data = req.body() if method == "POST" else None
            with self.store.lock:
                return (
                    self.store.update(
                        id, data.get("sku"), data.get("quantity"), products
                    )
                    if data is not None
                    else self.store.cart(id, products)
                )
        if path == "/api/orders" and method == "POST":
            raise HttpError(410, "Demo orders are disabled. Use Razorpay checkout.")

    def static(self, req):
        if req.method not in ("GET", "HEAD"):
            return
        path = "/admin.html" if req.path == "/admin" else req.path
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
                ROOT
                / "services/frontend/dist"
                / ("index.html" if path == "/" else path[1:])
            )
        elif re.fullmatch(r"/product-media/[a-z0-9-]+\.(?:jpg|png)", path):
            file = ROOT / "services/frontend/dist" / path[1:]
        elif re.fullmatch(r"/illustrations/(robot|kit|component|accessory)\.svg", path):
            file = ROOT / "services/frontend/dist" / path[1:]
        elif re.fullmatch("/images/[a-zA-Z0-9_-]+\.png", path):
            file = ROOT / "legacy/original-robotshop/web/static" / path[1:]
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
    client, db = connect_mongo()
    cart_repository = CartRepository(os.environ['CART_URL'], os.environ['CART_SERVICE_TOKEN']) if os.getenv('CART_URL') else None
    store = Store(os.getenv("DATA_DIR", str(ROOT / ".data")), cart_repository)
    gateway = Gateway(db, store)
    publisher = OrderPublisher(store, os.getenv("RABBITMQ_URL"))
    publisher.start()
    gateway.customers.start()
    try:
        serve("ai-gateway", 3000, gateway.handle)
    finally:
        publisher.stop()
        gateway.customers.stop()
        if hasattr(gateway, "demo_client"):
            gateway.demo_client.close()
        client.close()
