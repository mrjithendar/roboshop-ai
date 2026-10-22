import re
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, text, now
from catalogue import normalize
from auth import require_role, email_address

DEFAULTS = {
    "storeName": "RoboShop",
    "announcement": "THE NEXT GENERATION OF GOOD COMPANY.",
    "supportEmail": "team@jithendar.com",
    "checkoutEnabled": True,
}


def settings(db):
    return DEFAULTS | (db.settings.find_one({"_id": "public"}) or {}).get("value", {})


def routes(req, db, auth, store):
    actor = require_role(req.user, ("admin", "superadmin"))
    path = req.path
    method = req.method
    if path == "/api/admin/products" and method == "GET":
        products = list(db.products.find().sort("sku", 1).limit(10000))
        with store.lock:
            return {"products": [{k: v for k, v in p.items() if k != "_id"}
                                 | {"available": store.available(p)} for p in products]}
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
        with store.catalogue_lock:
            if match:
                existing = db.products.find_one({"_id": product["sku"]}) or {}
                if getattr(store, "backend", "json") == "postgres" and data.get("instock") != existing.get("instock"):
                    raise HttpError(409, "Use an audited PostgreSQL inventory adjustment; catalogue stock is no longer authoritative.")
                if existing.get("collection") == "reference" and product["instock"] != 0:
                    raise HttpError(400, "Reference inventory must remain zero and simulated.")
                if existing.get("showcase"):
                    if product["price"] != existing["price"]:
                        raise HttpError(
                            400,
                            "Source reference prices must be updated with reviewed provenance, not the live price editor.",
                        )
                    product["image"] = "/images/placeholder.png"

                with store.lock:
                    reserved = store.reserved(product["sku"])
                    if (product["archived"] and reserved > 0) or (
                        not product["archived"]
                        and getattr(store, "backend", "json") != "postgres"
                        and product["instock"]
                        < max(store.reserved(product["sku"], "live") + store.sold(product["sku"], "live"),
                              store.reserved(product["sku"], "test") + store.sold(product["sku"], "test"))
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
                if product["sku"].startswith("REF-"):
                    raise HttpError(400, "REF- SKUs are reserved for source-reviewed reference imports.")
                if db.products.count_documents({}) >= 10000:
                    raise HttpError(409, "Catalogue capacity reached.")
                try:
                    db.products.insert_one(
                        {
                            "_id": product["sku"],
                            **product,
                            "slug": product["sku"].lower().replace("_", "-"),
                            "currency": "INR",
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
