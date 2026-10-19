import re
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, text, now
from catalogue import normalize
from auth import require_role, public_user, email_address

DEFAULTS = {
    "storeName": "RobotShop",
    "announcement": "THE NEXT GENERATION OF GOOD COMPANY.",
    "supportEmail": "",
    "checkoutEnabled": True,
}


def settings(db):
    return DEFAULTS | (db.settings.find_one({"_id": "public"}) or {}).get("value", {})


def routes(req, db, auth, store):
    actor = require_role(req.user, ("admin", "superadmin"))
    path = req.path
    method = req.method
    if path == "/api/admin/products" and method == "GET":
        return {
            "products": [
                {k: v for k, v in p.items() if k != "_id"}
                | {"available": store.available(p)}
                for p in db.products.find().sort("sku", 1).limit(10000)
            ]
        }
    match = re.fullmatch(r"/api/admin/products/([A-Za-z0-9_-]{1,64})", path)
    if (path == "/api/admin/products" and method == "POST") or (
        match and method == "PUT"
    ):
        data = req.body()
        if set(data) - {
            "sku",
            "name",
            "description",
            "price",
            "instock",
            "categories",
            "archived",
            "revision",
        }:
            raise HttpError(400, "Unknown product field.")
        if "archived" in data and type(data["archived"]) is not bool:
            raise HttpError(400, "Archived must be true or false.")
        product = normalize(data)
        if match and (
            match[1] != product["sku"] or type(data.get("revision")) is not int
        ):
            raise HttpError(400, "SKU cannot change and a revision is required.")
        with store.lock:
            if match:
                existing = db.products.find_one({"_id": product["sku"]}) or {}
                if existing.get("showcase"):
                    if product["price"] != existing["price"]:
                        raise HttpError(
                            400,
                            "Source reference prices must be updated with reviewed provenance, not the live price editor.",
                        )
                    product["image"] = "/images/placeholder.png"

                reserved = store.reserved(product["sku"])
                if (product["archived"] and reserved > 0) or (
                    not product["archived"]
                    and product["instock"]
                    < reserved + store.state["sold"].get(product["sku"], 0)
                ):
                    raise HttpError(
                        409,
                        "Stock cannot fall below sold and reserved quantities; pending orders prevent archiving.",
                    )
                result = db.products.update_one(
                    {"_id": product["sku"], "revision": data["revision"]},
                    {
                        "$set": {
                            **product,
                            "updatedAt": now(),
                            "updatedBy": actor["id"],
                        },
                        "$inc": {"revision": 1},
                    },
                )
                if not result.matched_count:
                    raise HttpError(
                        409,
                        "Product changed or does not exist. Refresh before editing.",
                    )
            else:
                if db.products.count_documents({}) >= 10000:
                    raise HttpError(409, "Catalogue capacity reached.")
                try:
                    db.products.insert_one(
                        {
                            "_id": product["sku"],
                            **product,
                            "slug": product["sku"].lower().replace("_", "-"),
                            "currency": "EUR",
                            "priceType": "sale",
                            "showcase": False,
                            "revision": 1,
                            "updatedAt": now(),
                            "updatedBy": actor["id"],
                        }
                    )
                except DuplicateKeyError:
                    raise HttpError(409, "SKU already exists.")
        return {"saved": True}, 200 if match else 201, []
    require_role(actor, ["superadmin"])
    if path == "/api/admin/users" and method == "GET":
        after = req.query.get("after", "")
        if len(after) > 100:
            raise HttpError(400, "Invalid cursor.")
        users = list(
            auth.users.find(
                {"_id": {"$gt": after}} if after else {}, {"passwordHash": 0}
            )
            .sort("_id", 1)
            .limit(101)
        )
        return {
            "users": [public_user(u) for u in users[:100]],
            "next": users[99]["_id"] if len(users) > 100 else None,
        }
    match = re.fullmatch(r"/api/admin/users/([a-f0-9-]{36})", path)
    if match and method == "PATCH":
        return {"user": auth.change_user(actor, match[1], req.body())}
    if path == "/api/admin/settings":
        if method == "GET":
            return settings(db)
        if method == "PUT":
            data = req.body()
            if (
                set(data) - set(DEFAULTS)
                or type(data.get("checkoutEnabled")) is not bool
            ):
                raise HttpError(400, "Only public store settings can be changed here.")
            value = {
                "storeName": text(data.get("storeName"), "Store name", 60),
                "announcement": text(data.get("announcement"), "Announcement", 160),
                "supportEmail": (
                    ""
                    if data.get("supportEmail") == ""
                    else email_address(data.get("supportEmail"))
                ),
                "checkoutEnabled": data["checkoutEnabled"],
            }
            db.settings.update_one(
                {"_id": "public"},
                {
                    "$set": {
                        "value": value,
                        "updatedAt": now(),
                        "updatedBy": actor["id"],
                    }
                },
                upsert=True,
            )
            return value
    raise HttpError(404, "Admin endpoint not found.")
