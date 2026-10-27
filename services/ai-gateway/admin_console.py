"""Admin console read models (overview, orders) and the administrative audit trail.

Orders and revenue are superadmin-only: they contain customer names and addresses.
The audit trail records who changed what, but only field names and a small set of
non-sensitive values, never secrets, passwords or free text.
"""
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from auth import require_role
from runtime import HttpError, log_event

LOW_STOCK = 5
ORDER_STATUSES = ("creating", "payment_pending", "payment_review", "paid", "failed", "expired", "cancelled")
# Values that are safe and useful to show in the audit log; everything else is recorded by key only.
AUDIT_VALUES = {"status", "role", "disabled", "archived", "checkoutEnabled", "provider", "automaticFailover"}
SENSITIVE = re.compile(r"pass|secret|token|key|credential", re.I)
AUDIT_RETENTION = timedelta(days=365)
AUDIT_ACTIONS = (
    (r"/api/admin/products", "POST", "product.create"),
    (r"/api/admin/product-images", "POST", "product.image_upload"),
    (r"/api/admin/products/(?P<target>[A-Za-z0-9_-]{1,64})", "PUT", "product.update"),
    (r"/api/admin/users/(?P<target>[A-Za-z0-9_-]{1,64})", "PATCH", "user.access"),
    (r"/api/admin/settings", "PUT", "settings.update"),
    (r"/api/admin/reviews/(?P<target>[A-Za-z0-9:_-]{1,160})", "PATCH", "review.moderate"),
    (r"/api/admin/llm", "PUT", "llm.save"),
    (r"/api/admin/llm/test", "POST", "llm.test"),
    (r"/api/admin/llm/disconnect", "POST", "llm.disconnect"),
    (r"/api/admin/test-orders/(?P<target>[a-f0-9-]{36})/reconcile", "POST", "order.reconcile"),
)


def _parse(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _bounded_int(query, name, default, low, high):
    raw = query.get(name, [str(default)])[0] if isinstance(query.get(name), list) else query.get(name, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise HttpError(400, f"{name} must be a whole number.")
    return max(low, min(high, value))


def _param(query, name, default=""):
    value = query.get(name, default)
    return (value[0] if value else default) if isinstance(value, list) else value


def order_summary(order):
    shipping = order.get("shipping") or {}
    address, city = shipping.get("address") or {}, shipping.get("city") or {}
    return {
        "id": order["id"], "status": order.get("status"), "paymentMode": order.get("paymentMode"),
        "createdAt": order.get("createdAt"), "paidAt": order.get("paidAt"),
        "currency": order.get("currency"), "subtotal": order.get("subtotal"), "total": order.get("total"),
        "items": [{"sku": i.get("sku"), "name": i.get("name"), "quantity": i.get("quantity"), "lineTotal": i.get("lineTotal")}
                  for i in order.get("items", [])],
        "shipping": {"recipient": address.get("recipient"), "city": city.get("name"), "country": city.get("country"),
                     "cost": shipping.get("cost")},
        "paymentId": order.get("paymentId") or order.get("razorpayPaymentId"),
        "customerId": order.get("userId"),
        "demo": order.get("demo", False),
    }


def overview(user, db, store):
    actor = require_role(user, ("admin", "superadmin"))
    products = list(db.products.find({}, {"_id": 0, "sku": 1, "name": 1, "instock": 1, "archived": 1, "collection": 1,
                                          "showcase": 1, "categories": 1}).limit(10000))
    with store.lock:
        sellable = [p | {"available": store.available(p)} for p in products if not p.get("archived")
                    and p.get("collection") != "reference" and not p.get("showcase")]
    low = sorted((p for p in sellable if 0 < p["available"] <= LOW_STOCK), key=lambda p: p["available"])
    result = {
        "catalogue": {"total": len(products), "active": sum(not p.get("archived") for p in products),
                      "archived": sum(bool(p.get("archived")) for p in products),
                      "outOfStock": sum(p["available"] <= 0 for p in sellable), "lowStock": len(low),
                      "lowStockItems": [{"sku": p["sku"], "name": p["name"], "available": p["available"]} for p in low[:10]]},
        "reviews": {"pending": db.reviews.count_documents({"status": "pending"})},
    }
    if actor.get("role") != "superadmin":
        return result
    with store.lock:
        orders = [dict(o) for o in store.orders()]
    now = datetime.now(timezone.utc)
    days = [(now - timedelta(days=n)).date() for n in range(13, -1, -1)]
    daily = {(d.isoformat(), c): 0.0 for d in days for c in ("INR",)}
    revenue = defaultdict(lambda: {"day": 0.0, "week": 0.0, "month": 0.0})
    statuses, buyers = Counter(), set()
    for order in orders:
        if order.get("paymentMode") != "live":
            continue
        statuses[order.get("status", "unknown")] += 1
        paid = _parse(order.get("paidAt")) if order.get("status") == "paid" else None
        if not paid:
            continue
        if paid.tzinfo is None:
            paid = paid.replace(tzinfo=timezone.utc)
        currency, total, age = order.get("currency", "INR"), float(order.get("total") or 0), now - paid
        for window, limit in (("day", 1), ("week", 7), ("month", 30)):
            if age <= timedelta(days=limit):
                revenue[currency][window] += total
        if paid.date() in days:
            key = (paid.date().isoformat(), currency)
            daily[key] = daily.get(key, 0.0) + total
        if order.get("userId"):
            buyers.add(order["userId"])
    recent = sorted(orders, key=lambda o: o.get("createdAt") or "", reverse=True)[:8]
    result["orders"] = {
        "byStatus": dict(statuses), "liveTotal": sum(statuses.values()),
        "testTotal": sum(o.get("paymentMode") == "test" for o in orders),
        "needsAttention": statuses.get("payment_review", 0),
        "revenue": {c: {k: round(v, 2) for k, v in w.items()} for c, w in revenue.items()},
        "daily": [{"date": d, "currency": c, "total": round(v, 2)} for (d, c), v in sorted(daily.items())],
        "customers": len(buyers),
        "recent": [order_summary(o) for o in recent],
    }
    return result


def orders(user, store, query):
    require_role(user, ["superadmin"])
    mode, status, search = _param(query, "mode", "live"), _param(query, "status"), _param(query, "q").strip().lower()
    if mode not in ("live", "test", "all"):
        raise HttpError(400, "mode must be live, test or all.")
    if status and status not in ORDER_STATUSES:
        raise HttpError(400, "Unknown order status.")
    if len(search) > 100:
        raise HttpError(400, "Search is limited to 100 characters.")
    offset, limit = _bounded_int(query, "offset", 0, 0, 100000), _bounded_int(query, "limit", 25, 1, 100)
    with store.lock:
        rows = [order_summary(o) for o in store.orders(None if mode == "all" else mode)]
    if status:
        rows = [o for o in rows if o["status"] == status]
    if search:
        rows = [o for o in rows if search in o["id"] or search in (o["paymentId"] or "").lower()
                or search in (o["shipping"]["recipient"] or "").lower() or any(search in (i["sku"] or "").lower() for i in o["items"])]
    rows.sort(key=lambda o: o.get("createdAt") or "", reverse=True)
    return {"orders": rows[offset:offset + limit], "total": len(rows), "offset": offset, "limit": limit}


def audit_listing(user, db, query):
    require_role(user, ["superadmin"])
    action, outcome = _param(query, "action"), _param(query, "outcome")
    offset, limit = _bounded_int(query, "offset", 0, 0, 100000), _bounded_int(query, "limit", 50, 1, 200)
    match = {}
    if action:
        if not re.fullmatch(r"[a-z]+(\.[a-z]+)?", action):
            raise HttpError(400, "Invalid action filter.")
        match["action"] = {"$regex": "^" + re.escape(action)}
    if outcome in ("success", "failure"):
        match["outcome"] = outcome
    rows = list(db.admin_audit.find(match, {"_id": 0}).sort("at", -1).skip(offset).limit(limit))
    for row in rows:
        row["at"] = row["at"].replace(tzinfo=timezone.utc).isoformat() if isinstance(row.get("at"), datetime) else row.get("at")
    return {"entries": rows, "total": db.admin_audit.count_documents(match), "offset": offset, "limit": limit}


def classify(method, path):
    for pattern, verb, action in AUDIT_ACTIONS:
        found = re.fullmatch(pattern, path)
        if found and verb == method:
            return action, found.groupdict().get("target")
    return None, None


def record(db, req, actor, status, body=None):
    """Best effort: an audit write failure is logged loudly but never undoes the change."""
    action, target = classify(req.method, req.path)
    if not action:
        return
    fields = sorted(k for k in (body or {}) if isinstance(k, str) and not SENSITIVE.search(k) and k != "revision")
    values = {k: body[k] for k in fields if k in AUDIT_VALUES and isinstance(body[k], (str, bool, int))}
    if action == "product.create" and isinstance((body or {}).get("sku"), str):
        target = body["sku"][:64]
    entry = {
        "at": datetime.now(timezone.utc), "action": action, "target": target,
        "actor": {k: (actor or {}).get(k) for k in ("id", "email", "role")},
        "outcome": "success" if status < 400 else "failure", "status": status, "fields": fields, "values": values,
    }
    try:
        db.admin_audit.insert_one(entry)
    except Exception as error:  # Audit storage must not fail the already-applied change.
        log_event("admin_audit_write_failed", "ERROR", errorType=type(error).__name__, operation=action)


def ensure_indexes(db):
    db.admin_audit.create_index([("action", 1), ("at", -1)])
    db.admin_audit.create_index("at", name="audit_retention", expireAfterSeconds=int(AUDIT_RETENTION.total_seconds()))
