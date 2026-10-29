"""Synthetic stand-in for the RoboShop gateway, for tests and the local demo only.

It mimics the gateway's public contract (paths, roles, ownership, revisions, error bodies) with
fixed synthetic data. It is not the real gateway and never touches real accounts or payments.
"""
import copy
import hashlib
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

ORIGIN = "http://localhost:3000"


def token(name):
    return hashlib.sha256(("roboshop-demo:" + name).encode()).hexdigest()


USERS = {
    token("customer"): {"id": "00000000-0000-4000-8000-000000000001", "email": "ada.customer@example.test", "name": "Ada (synthetic)", "role": "customer", "disabled": False},
    token("customer-2"): {"id": "00000000-0000-4000-8000-000000000002", "email": "bo.customer@example.test", "name": "Bo (synthetic)", "role": "customer", "disabled": False},
    token("admin"): {"id": "00000000-0000-4000-8000-000000000003", "email": "cy.admin@example.test", "name": "Cy (synthetic)", "role": "admin", "disabled": False},
    token("superadmin"): {"id": "00000000-0000-4000-8000-000000000004", "email": "di.owner@example.test", "name": "Di (synthetic)", "role": "superadmin", "disabled": False},
}
PASSWORDS = {"ada.customer@example.test": token("customer")}
DEMO = {"demo": True, "synthetic": True, "collection": "demo", "fulfilment": "simulated", "showcase": False}
PRODUCTS = [
    {"sku": "DEMO-ROVER-1", "slug": "demo-rover-1", "name": "Inspection Rover (synthetic)", "price": 74999, "currency": "INR",
     "priceType": "sale", "instock": 5, "categories": ["robot", "inspection"], "revision": 3,
     "description": "Tracked rover for warehouse and pipe-rack inspection with thermal camera.", **DEMO},
    {"sku": "DEMO-CRAWLER-2", "slug": "demo-crawler-2", "name": "Pipe Crawler (synthetic)", "price": 52999, "currency": "INR",
     "priceType": "sale", "instock": 2, "categories": ["robot", "inspection"], "revision": 1,
     "description": "Magnetic crawler for pipe and tank inspection.", **DEMO},
    {"sku": "DEMO-ARM-3", "slug": "demo-arm-3", "name": "Bench Arm (synthetic)", "price": 18999, "currency": "INR",
     "priceType": "sale", "instock": 12, "categories": ["robot arms"], "revision": 1,
     "description": "Six-axis desktop arm for pick-and-place practice.", **DEMO},
    {"sku": "REF-QUAD-4", "slug": "ref-quad-4", "name": "Reference Quadruped", "price": 74500, "currency": "USD",
     "priceType": "reference", "instock": 0, "categories": ["robot", "inspection"], "revision": 1,
     "description": "Published list price of a legged inspection robot; not sold here.", "collection": "reference",
     "fulfilment": "simulated", "demo": False, "synthetic": False, "showcase": True, "sourceKind": "manufacturer",
     "priceCheckedAt": "2026-10-01", "sources": [{"label": "Manufacturer price list (example)", "url": "https://example.com/quadruped"}]},
]
POLICY = "Compare amounts only within the same currency, price type and collection. Reference prices are not merchant offers."


class FixtureGateway:
    def __init__(self):
        self.products = copy.deepcopy(PRODUCTS)
        self.users = copy.deepcopy(USERS)
        self.carts = {}
        self.pending = set()
        self.settings = {"storeName": "RoboShop demo", "announcement": "", "supportEmail": "", "checkoutEnabled": True}
        self.ready = True
        self.requests = []  # (method, path, traceparent, has_cookie, completed)
        self.faults = {}  # path -> list of faults consumed per call: connect, slow, garbage, huge, 503, 429
        self.spans = []
        self.lock = threading.Lock()

    # Shared request handling: (status, payload) only; transports add the wire format.
    def handle(self, method, path, query, headers, body):
        user = None
        match = re.fullmatch(r"rs_auth=([a-f0-9]{64})", headers.get("cookie", ""))
        if match and match[1] in self.users and not self.users[match[1]]["disabled"]:
            user = self.users[match[1]]
        if method != "GET" and headers.get("origin") != ORIGIN:
            return 403, {"error": "Origin not allowed."}
        if path in ("/api/ready", "/health/ready"):
            deps = {"mongodb": "ready", "catalogue": "ready" if self.ready else "unavailable", "users": "ready", "ledger": "ready"}
            return (200 if self.ready else 503), {"status": "ready" if self.ready else "unavailable", "dependencies": deps}
        if path == "/api/auth/login" and method == "POST":
            session = PASSWORDS.get(body.get("email")) if body.get("password") == "synthetic-demo-password" else None
            if not session:
                return 401, {"error": "Invalid email or password."}
            return 200, {"user": self.users[session], "session": session}
        if path == "/api/auth/me":
            return 200, {"user": user}
        live = [p for p in self.products if not p.get("archived")]
        if path == "/api/recommendations" and method == "GET":
            words = [w for w in re.findall(r"[a-z]+", query.get("q", "").lower()) if len(w) > 2]
            hits = [p for p in live if (p["instock"] > 0 or p["collection"] == "reference")
                    and (not query.get("category") or query["category"] in p["categories"])
                    and (not words or any(w in (p["name"] + p["description"] + " ".join(p["categories"])).lower() for w in words))]
            hits = [{**p, "reason": "Matches the query in the synthetic catalogue."} for p in hits[:int(query.get("limit", 4))]]
            return 200, {"products": hits, "strategy": "catalogue-keyword-ranking", "personalized": False}
        if path == "/api/compare" and method == "GET":
            skus = query.get("skus", "").split(",")
            rows = {p["sku"]: p for p in live}
            if any(s not in rows for s in skus):
                return 404, {"error": "Product not found."}
            chosen = [rows[s] for s in skus]
            same = len({(p["currency"], p["priceType"], p["collection"]) for p in chosen}) == 1
            return 200, {"products": chosen, "currency": chosen[0]["currency"] if len({p["currency"] for p in chosen}) == 1 else None,
                         "lowestPrice": min(p["price"] for p in chosen) if same else None, "priceComparisonPolicy": POLICY}
        if path == "/api/shipping/countries":
            return 200, {"countries": [{"code": "IN", "name": "India", "cityCount": 2}], "source": "GeoNames", "license": "CC BY 4.0"}
        if path == "/api/shipping/cities":
            if query.get("country") != "IN" or len(query.get("q", "")) < 2:
                return 400, {"error": "Select a valid country."}
            cities = [{"id": 1, "countryCode": "IN", "name": n, "region": r} for n, r in (("Bengaluru", "Karnataka"), ("Bhopal", "Madhya Pradesh"))]
            return 200, {"cities": [c for c in cities if c["name"].lower().startswith(query["q"].lower())]}
        if path.startswith("/api/cart") or path.startswith("/api/recommendations/personalized") or path.startswith("/api/admin/"):
            if not user:
                return 401, {"error": "Please log in to continue."}
        if path == "/api/cart":
            cart = self.carts.setdefault(user["id"], {})
            if method == "POST":
                if user["id"] in self.pending:
                    return 409, {"error": "A payment is pending. Complete or reconcile it before changing your bag."}
                product = next((p for p in live if p["sku"] == body.get("sku")), None)
                if body.get("quantity", 0) > 0 and not product:
                    return 404, {"error": "Product not found."}
                if product and body["quantity"] > product["instock"]:
                    return 409, {"error": "Requested quantity exceeds available stock."}
                if body["quantity"] == 0:
                    cart.pop(body["sku"], None)
                else:
                    cart[body["sku"]] = body["quantity"]
            return 200, self.cart(cart)
        if path == "/api/recommendations/personalized":
            return 200, {"products": [p for p in live if p["instock"] > 0][:3], "basis": "in-stock-catalogue", "currency": "INR"}
        if path.startswith("/api/admin/"):
            return self.admin(method, path, query, user, body)
        return 404, {"error": "Not found"}

    def cart(self, cart):
        items = []
        for sku, quantity in cart.items():
            p = next(p for p in self.products if p["sku"] == sku)
            items.append({**p, "quantity": quantity, "lineTotal": p["price"] * quantity})
        subtotal = sum(i["lineTotal"] for i in items)
        return {"items": items, "subtotal": subtotal, "shipping": None, "total": subtotal, "currency": "INR"}

    def admin(self, method, path, query, user, body):
        if user["role"] not in ("admin", "superadmin"):
            return 403, {"error": "Forbidden"}
        match = re.fullmatch(r"/api/admin/products(?:/([A-Za-z0-9_-]+))?", path)
        if match:
            if method == "GET":
                return 200, {"products": [p | {"available": p["instock"]} for p in self.products], "stockEditable": True}
            existing = next((p for p in self.products if p["sku"] == body.get("sku")), None)
            if method == "POST":
                if existing:
                    return 409, {"error": "SKU already exists."}
                self.products.append({**body, **DEMO, "currency": "INR", "priceType": "sale", "slug": body["sku"].lower(), "revision": 1})
                return 201, {"saved": True}
            if not existing or existing["revision"] != body.get("revision"):
                return 409, {"error": "Product changed or does not exist. Refresh before editing."}
            existing.update({k: v for k, v in body.items() if k != "revision"}, revision=existing["revision"] + 1)
            return 200, {"saved": True}
        if user["role"] != "superadmin":
            return 403, {"error": "Forbidden"}
        if path == "/api/admin/users" and method == "GET":
            return 200, {"users": sorted(self.users.values(), key=lambda u: u["id"]), "next": None}
        match = re.fullmatch(r"/api/admin/users/([a-f0-9-]{36})", path)
        if match and method == "PATCH":
            target = next((u for u in self.users.values() if u["id"] == match[1]), None)
            if not target:
                return 404, {"error": "User not found."}
            if target["role"] == "superadmin":
                return 409, {"error": "The super admin account cannot be changed."}
            target.update(role=body["role"], disabled=body["disabled"])
            return 200, {"user": target}
        if path == "/api/admin/settings":
            if method == "PUT":
                self.settings = dict(body)
            return 200, self.settings
        return 404, {"error": "Admin endpoint not found."}

    def respond(self, method, path, query, headers, body):
        """Gateway-shaped JSON response with requestId taken from the propagated trace."""
        trace_id = (headers.get("traceparent", "").split("-") + ["", ""])[1]
        with self.lock:
            record = [method, path, headers.get("traceparent"), "cookie" in headers, False]
            self.requests.append(record)
            status, payload = self.handle(method, path, query, headers, body)
            record[4] = True
        if status >= 400:
            payload = {"error": payload.get("error", "The request could not be completed."), "requestId": trace_id or None}
        return status, payload

    def transport(self):
        """httpx2.MockTransport for in-process tests, with injectable faults."""
        import anyio
        import httpx2

        async def handler(request):
            path, query = request.url.path, dict(request.url.params)
            fault = (self.faults.get(path) or [None]).pop(0) if self.faults.get(path) else None
            if fault == "connect":
                raise httpx2.ConnectError("synthetic connection refused", request=request)
            if fault == "slow":
                await anyio.sleep(30)
            if isinstance(fault, int):
                self.requests.append([request.method, path, request.headers.get("traceparent"), "cookie" in request.headers, True])
                return httpx2.Response(fault, json={"error": "internal detail http://10.0.0.7:4108 stack", "requestId": "x"})
            if fault == "garbage":
                return httpx2.Response(200, content=b"<html>not json</html>")
            if fault == "huge":
                return httpx2.Response(200, content=b'{"products": [' + b'"x",' * 400000 + b'"x"]}')
            if isinstance(fault, float):
                await anyio.sleep(fault)  # Delayed but completes, even if the caller has gone away.
            body = json.loads(request.content) if request.content else {}
            status, payload = self.respond(request.method, path, query, {k.lower(): v for k, v in request.headers.items()}, body)
            trace_id = (request.headers.get("traceparent", "").split("-") + ["", ""])[1] or "f" * 32
            return httpx2.Response(status, json=payload, headers={"x-request-id": trace_id})
        return httpx2.MockTransport(handler)

    def serve(self, host="127.0.0.1", port=0):
        """Real HTTP listener for the demo; also accepts OTLP/JSON spans at /v1/traces."""
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def _send(self, status, payload):
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _dispatch(self):
                url = urlsplit(self.path)
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length)) if length else {}
                if url.path == "/v1/traces":
                    with fixture.lock:
                        fixture.spans.append(body)
                    return self._send(200, {})
                headers = {k.lower(): v for k, v in self.headers.items()}
                self._send(*fixture.respond(self.command, url.path, dict(parse_qsl(url.query)), headers, body))

            do_GET = do_POST = do_PUT = do_PATCH = _dispatch

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer((host, port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server
