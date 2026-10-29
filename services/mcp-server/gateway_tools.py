"""Service-owned tool catalogue: strict input/output contracts, roles and gateway routes.

No MCP wire protocol here. Roles only filter discovery and fail fast; the gateway (and the
user service behind it) authorizes every call again with the caller's own session.
"""

import math
import re
from datetime import datetime, timezone
from urllib.parse import quote

CUSTOMER = ("customer", "admin", "superadmin")
ADMIN = ("admin", "superadmin")
SUPERADMIN = ("superadmin",)
SKU = {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$", "description": "Catalogue SKU, for example ATLAS-X1."}
USER_ID = {"type": "string", "pattern": "^[a-f0-9-]{36}$"}
NULLABLE_STRING = {"type": ["string", "null"]}
NULLABLE_NUMBER = {"type": ["number", "null"]}
NULLABLE_INTEGER = {"type": ["integer", "null"]}
NULLABLE_BOOLEAN = {"type": ["boolean", "null"]}


def strict(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


PROVENANCE = strict({
    "collection": NULLABLE_STRING,
    "fulfilment": NULLABLE_STRING,
    "demo": NULLABLE_BOOLEAN,
    "synthetic": NULLABLE_BOOLEAN,
    "showcase": NULLABLE_BOOLEAN,
    "sourceKind": NULLABLE_STRING,
    "priceBasis": NULLABLE_STRING,
    "priceCheckedAt": NULLABLE_STRING,
    "sources": {"type": "array", "maxItems": 10, "items": strict({"label": {"type": "string"}, "url": {"type": "string"}}, ["label", "url"])},
}, ["collection", "fulfilment", "demo", "synthetic", "showcase", "sourceKind", "priceBasis", "priceCheckedAt", "sources"])
PRODUCT_VIEW = strict({
    "sku": {"type": "string"},
    "slug": NULLABLE_STRING,
    "name": {"type": "string"},
    "description": {"type": "string", "maxLength": 1000},
    "categories": {"type": "array", "items": {"type": "string"}},
    "price": NULLABLE_NUMBER,
    "currency": NULLABLE_STRING,
    "priceType": {"enum": ["sale", "reference", "on-request", "illustrative", None]},
    "inStock": {**NULLABLE_INTEGER, "description": "Live available units; null when the gateway did not report stock."},
    "inventoryStatus": NULLABLE_STRING,
    "reason": NULLABLE_STRING,
    "provenance": PROVENANCE,
}, ["sku", "slug", "name", "description", "categories", "price", "currency", "priceType", "inStock", "inventoryStatus", "reason", "provenance"])
OBSERVED = {"type": "string", "description": "UTC time this server received the gateway response; stock is live as of then."}
CART = strict({
    "items": {"type": "array", "items": strict({
        "sku": {"type": "string"},
        "quantity": {"type": "integer"},
        "available": {"type": "boolean", "description": "False when the product can no longer be bought; price fields are then null."},
        "name": NULLABLE_STRING,
        "price": NULLABLE_NUMBER,
        "currency": NULLABLE_STRING,
        "priceType": NULLABLE_STRING,
        "lineTotal": NULLABLE_NUMBER,
        "inStock": NULLABLE_INTEGER,
    }, ["sku", "quantity", "available", "name", "price", "currency", "priceType", "lineTotal", "inStock"])},
    "subtotal": {"type": "number"},
    "shippingCost": {**NULLABLE_NUMBER, "description": "Null until a shipping quote is selected."},
    "total": {"type": "number"},
    "currency": {"type": "string"},
    "observedAt": OBSERVED,
}, ["items", "subtotal", "shippingCost", "total", "currency", "observedAt"])
SETTINGS = strict({
    "storeName": {"type": "string", "minLength": 1, "maxLength": 60},
    "announcement": {"type": "string", "maxLength": 160},
    "supportEmail": {"type": "string", "maxLength": 254, "pattern": r"^$|^[^\s@]+@[^\s@]+\.[^\s@]+$"},
    "checkoutEnabled": {"type": "boolean"},
}, ["storeName", "announcement", "supportEmail", "checkoutEnabled"])
PRODUCT_INPUT = {
    "sku": SKU,
    "name": {"type": "string", "minLength": 1, "maxLength": 200},
    "description": {"type": "string", "minLength": 1, "maxLength": 3000},
    "price": {"type": "number", "minimum": 0, "maximum": 1000000, "description": "Sale price in INR."},
    "instock": {"type": "integer", "minimum": 0, "maximum": 1000000},
    "categories": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 100}, "minItems": 1, "maxItems": 50, "uniqueItems": True},
    "archived": {"type": "boolean"},
}


def observed():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _text(value, limit=None):
    return value[:limit] if isinstance(value, str) and limit else value if isinstance(value, str) else None


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def _integer(value):
    return value if type(value) is int else None


def _boolean(value):
    return value if type(value) is bool else None


def product_view(p):
    """Stable projection; absent facts stay null instead of becoming zero or empty text."""
    sources = p.get("sources") if isinstance(p.get("sources"), list) else []
    return {
        "sku": p["sku"],
        "slug": _text(p.get("slug")),
        "name": _text(p.get("name")) or p["sku"],
        "description": _text(p.get("description"), 1000) or "",
        "categories": [c for c in p.get("categories", []) if isinstance(c, str)][:50],
        "price": _number(p.get("price")),
        "currency": _text(p.get("currency")),
        "priceType": p.get("priceType") if p.get("priceType") in ("sale", "reference", "on-request", "illustrative") else None,
        "inStock": _integer(p.get("instock")),
        "inventoryStatus": _text(p.get("inventoryStatus")),
        "reason": _text(p.get("reason"), 300),
        "provenance": {
            "collection": _text(p.get("collection")),
            "fulfilment": _text(p.get("fulfilment")),
            "demo": _boolean(p.get("demo")),
            "synthetic": _boolean(p.get("synthetic")),
            "showcase": _boolean(p.get("showcase")),
            "sourceKind": _text(p.get("sourceKind")),
            "priceBasis": _text(p.get("priceBasis")),
            "priceCheckedAt": _text(p.get("priceCheckedAt") or p.get("checkedAt")),
            "sources": [{"label": s["label"], "url": s["url"]} for s in sources[:10]
                        if isinstance(s, dict) and isinstance(s.get("label"), str) and isinstance(s.get("url"), str)],
        },
    }


def products(data):
    rows = data.get("products")
    if not isinstance(rows, list) or not all(isinstance(p, dict) and isinstance(p.get("sku"), str) for p in rows):
        raise ValueError("products")
    return [product_view(p) for p in rows]


def cart_view(data, args=None):
    if not isinstance(data.get("items"), list):
        raise ValueError("cart")
    items = []
    for row in data["items"]:
        available = not row.get("unavailable")
        items.append({
            "sku": row["sku"], "quantity": row["quantity"], "available": available,
            "name": _text(row.get("name")) if available else None,
            "price": _number(row.get("price")) if available else None,
            "currency": _text(row.get("currency")) if available else None,
            "priceType": _text(row.get("priceType")) if available else None,
            "lineTotal": _number(row.get("lineTotal")) if available else None,
            "inStock": _integer(row.get("instock")) if available else None,
        })
    shipping = data.get("shipping")
    return {"items": items, "subtotal": data["subtotal"], "total": data["total"], "currency": data["currency"],
            "shippingCost": _number(shipping.get("cost")) if isinstance(shipping, dict) else None, "observedAt": observed()}


class ToolSpec:
    def __init__(self, name, title, description, properties, required, output, request, shape, *,
                 roles=None, write=False, destructive=False, idempotent=True, confirm=None, accept=()):
        self.name, self.title, self.description = name, title, description
        self.input_schema = strict(properties, required)
        self.output_schema = output
        self.request, self.shape = request, shape
        self.roles, self.write, self.confirm, self.accept = roles, write, confirm, accept
        # Hints for clients only; the gateway remains the authorization boundary.
        self.annotations = {"title": title, "readOnlyHint": not write, "destructiveHint": write and destructive,
                            "idempotentHint": idempotent, "openWorldHint": False}

    @property
    def side_effects(self):
        return "none" if not self.write else "changes store data"


def _search_request(args):
    params = {"q": args["query"], "limit": args.get("limit", 4)}
    params |= {k: args[k] for k in ("category", "budget") if k in args}
    return "GET", "/api/recommendations", params, None


TOOLS = [
    ToolSpec(
        "search_products", "Search products",
        "Find catalogue products for a shopper's need, for example 'warehouse inspection robot'. "
        "Use before comparing or adding to a cart. Results keep each listing's own currency and price type; "
        "reference and illustrative prices are not merchant offers. An empty list means nothing matched.",
        {"query": {"type": "string", "minLength": 1, "maxLength": 300},
         "category": {"type": "string", "pattern": "^[a-z0-9][a-z0-9 -]{0,39}$", "description": "Optional category, for example robot."},
         "budget": {"type": "number", "minimum": 0, "maximum": 1000000,
                    "description": "Optional maximum price. Applies to the currency named in the query (INR, USD or EUR), else the catalogue currency; on-request prices are excluded."},
         "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 4}},
        ["query"],
        strict({"products": {"type": "array", "items": PRODUCT_VIEW}, "resultCount": {"type": "integer"},
                "strategy": NULLABLE_STRING, "observedAt": OBSERVED},
               ["products", "resultCount", "strategy", "observedAt"]),
        _search_request,
        lambda data, args: {"products": products(data), "resultCount": len(data["products"]),
                            "strategy": _text(data.get("strategy")), "observedAt": observed()},
    ),
    ToolSpec(
        "compare_products", "Compare products",
        "Compare 2-4 specific SKUs side by side with live stock. lowestPrice is null whenever the listings "
        "differ in currency, price type or collection, because those prices are not comparable.",
        {"skus": {"type": "array", "items": SKU, "minItems": 2, "maxItems": 4, "uniqueItems": True}},
        ["skus"],
        strict({"products": {"type": "array", "items": PRODUCT_VIEW}, "currency": NULLABLE_STRING,
                "lowestPrice": NULLABLE_NUMBER, "comparable": {"type": "boolean"},
                "priceComparisonPolicy": {"type": "string"}, "observedAt": OBSERVED},
               ["products", "currency", "lowestPrice", "comparable", "priceComparisonPolicy", "observedAt"]),
        lambda args: ("GET", "/api/compare", {"skus": ",".join(args["skus"])}, None),
        lambda data, args: {"products": products(data), "currency": _text(data.get("currency")),
                            "lowestPrice": _number(data.get("lowestPrice")),
                            "comparable": _number(data.get("lowestPrice")) is not None,
                            "priceComparisonPolicy": data["priceComparisonPolicy"], "observedAt": observed()},
    ),
    ToolSpec(
        "shipping_countries", "List shipping countries",
        "List countries the store ships to, with their ISO codes. Use the code with shipping_cities.",
        {}, (),
        strict({"countries": {"type": "array", "items": strict(
            {"code": {"type": "string"}, "name": {"type": "string"}, "cityCount": NULLABLE_INTEGER},
            ["code", "name", "cityCount"])}, "source": NULLABLE_STRING, "license": NULLABLE_STRING},
            ["countries", "source", "license"]),
        lambda args: ("GET", "/api/shipping/countries", None, None),
        lambda data, args: {"countries": [{"code": c["code"], "name": c["name"], "cityCount": _integer(c.get("cityCount"))}
                                          for c in data["countries"]],
                            "source": _text(data.get("source")), "license": _text(data.get("license"))},
    ),
    ToolSpec(
        "shipping_cities", "Search shipping cities",
        "Find up to 30 cities in one shipping country by name prefix. Requires the ISO country code from shipping_countries.",
        {"country": {"type": "string", "pattern": "^[A-Z]{2}$", "description": "ISO 3166-1 alpha-2 code, for example IN."},
         "q": {"type": "string", "minLength": 2, "maxLength": 80, "description": "City name prefix."}},
        ["country", "q"],
        strict({"cities": {"type": "array", "items": strict(
            {"id": {"type": ["integer", "string"]}, "name": {"type": "string"}, "region": NULLABLE_STRING,
             "countryCode": {"type": "string"}}, ["id", "name", "region", "countryCode"])}},
            ["cities"]),
        lambda args: ("GET", "/api/shipping/cities", {"country": args["country"], "q": args["q"]}, None),
        lambda data, args: {"cities": [{"id": c["id"], "name": c["name"], "region": _text(c.get("region")),
                                        "countryCode": c["countryCode"]} for c in data["cities"]]},
    ),
    ToolSpec(
        "service_health", "Check store readiness",
        "Check whether the store's core dependencies (database, catalogue, users, order ledger, cart) are ready. "
        "Read-only; use when a shopping tool reports a dependency failure.",
        {}, (),
        strict({"status": {"enum": ["ready", "unavailable"]},
                "dependencies": {"type": "object", "additionalProperties": {"enum": ["ready", "unavailable"]}}},
               ["status", "dependencies"]),
        lambda args: ("GET", "/api/ready", None, None),
        lambda data, args: {"status": "ready" if data.get("status") == "ready" else "unavailable",
                            "dependencies": {str(k)[:40]: "ready" if v == "ready" else "unavailable"
                                             for k, v in list(data.get("dependencies", {}).items())[:20]}},
        accept=(503,),
    ),
    ToolSpec(
        "personalized_recommendations", "Recommend for my cart",
        "Recommend in-stock products related to the categories already in the signed-in shopper's cart.",
        {}, (),
        strict({"products": {"type": "array", "items": PRODUCT_VIEW},
                "basis": {"enum": ["cart-categories", "in-stock-catalogue"]}, "currency": NULLABLE_STRING,
                "observedAt": OBSERVED}, ["products", "basis", "currency", "observedAt"]),
        lambda args: ("GET", "/api/recommendations/personalized", None, None),
        lambda data, args: {"products": products(data), "basis": data["basis"], "currency": _text(data.get("currency")),
                            "observedAt": observed()},
        roles=CUSTOMER,
    ),
    ToolSpec(
        "view_cart", "View my cart",
        "Read the signed-in shopper's own cart with live stock and totals. Never another account's cart.",
        {}, (), CART,
        lambda args: ("GET", "/api/cart", None, None),
        cart_view,
        roles=CUSTOMER,
    ),
    ToolSpec(
        "update_cart", "Set cart quantity",
        "Set the quantity of one SKU in the signed-in shopper's own cart; 0 removes it. Repeating the same call "
        "has no further effect. Does not reserve stock, take payment or place an order. Fails with a conflict "
        "while a payment is pending or when stock is insufficient.",
        {"sku": SKU, "quantity": {"type": "integer", "minimum": 0, "maximum": 20}},
        ["sku", "quantity"], CART,
        lambda args: ("POST", "/api/cart", None, {"sku": args["sku"], "quantity": args["quantity"]}),
        cart_view,
        roles=CUSTOMER, write=True, destructive=True, idempotent=True,
    ),
    ToolSpec(
        "admin_list_products", "Admin: list products",
        "Admin: list catalogue products with revision numbers, stock and available units, in SKU order. "
        "Use the revision with admin_update_product.",
        {"after": {**SKU, "description": "Return products after this SKU."},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}},
        (),
        strict({"products": {"type": "array", "items": strict({
            "sku": {"type": "string"}, "name": {"type": "string"}, "price": NULLABLE_NUMBER,
            "currency": NULLABLE_STRING, "priceType": NULLABLE_STRING, "instock": NULLABLE_INTEGER,
            "available": NULLABLE_INTEGER, "archived": {"type": "boolean"}, "revision": NULLABLE_INTEGER,
            "categories": {"type": "array", "items": {"type": "string"}}},
            ["sku", "name", "price", "currency", "priceType", "instock", "available", "archived", "revision", "categories"])},
            "stockEditable": {"type": "boolean"}, "nextAfter": NULLABLE_STRING},
            ["products", "stockEditable", "nextAfter"]),
        lambda args: ("GET", "/api/admin/products", None, None),
        lambda data, args: _admin_products(data, args),
        roles=ADMIN,
    ),
    ToolSpec(
        "admin_create_product", "Admin: create product",
        "Admin: create a new INR sale product. Requires human confirmation in the MCP client. "
        "A duplicate SKU is rejected as a conflict, so a repeated submission cannot create a second product.",
        PRODUCT_INPUT, list(PRODUCT_INPUT)[:-1],
        strict({"saved": {"type": "boolean"}, "sku": {"type": "string"}}, ["saved", "sku"]),
        lambda args: ("POST", "/api/admin/products", None, args),
        lambda data, args: {"saved": data.get("saved") is True, "sku": args["sku"]},
        roles=ADMIN, write=True, destructive=False, idempotent=False,
        confirm=lambda a: f"Create product {a['sku']} ({a['name']}) at INR {a['price']} with {a['instock']} in stock?",
    ),
    ToolSpec(
        "admin_update_product", "Admin: update product",
        "Admin: replace a product's editable fields using the revision from admin_list_products. "
        "Stale revisions are rejected as conflicts; refresh and ask again rather than retrying. "
        "Requires human confirmation in the MCP client.",
        PRODUCT_INPUT | {"revision": {"type": "integer", "minimum": 1}},
        list(PRODUCT_INPUT) + ["revision"],
        strict({"saved": {"type": "boolean"}, "sku": {"type": "string"}}, ["saved", "sku"]),
        lambda args: ("PUT", "/api/admin/products/" + quote(args["sku"], safe=""), None, args),
        lambda data, args: {"saved": data.get("saved") is True, "sku": args["sku"]},
        roles=ADMIN, write=True, destructive=True, idempotent=False,
        confirm=lambda a: (f"Update product {a['sku']} (revision {a['revision']}): price {a['price']}, "
                           f"stock {a['instock']}, archived {a['archived']}?"),
    ),
    ToolSpec(
        "admin_list_users", "Super admin: list users",
        "Super admin: list up to 100 accounts with roles and disabled status; never password data. "
        "Pass next from the previous page as after.",
        {"after": USER_ID}, (),
        strict({"users": {"type": "array", "items": strict({
            "id": {"type": "string"}, "email": {"type": "string"}, "name": {"type": "string"},
            "role": {"enum": ["customer", "admin", "superadmin"]}, "disabled": {"type": "boolean"}},
            ["id", "email", "name", "role", "disabled"])}, "next": NULLABLE_STRING}, ["users", "next"]),
        lambda args: ("GET", "/api/admin/users", {"after": args["after"]} if "after" in args else None, None),
        lambda data, args: {"users": [{k: u[k] for k in ("id", "email", "name", "role", "disabled")} for u in data["users"]],
                            "next": _text(data.get("next"))},
        roles=SUPERADMIN,
    ),
    ToolSpec(
        "admin_set_user_access", "Super admin: set user access",
        "Super admin: set an account's role (customer or admin) and disabled status. The super admin account "
        "cannot be changed. Disabling or changing a role signs that user out. Requires human confirmation.",
        {"userId": USER_ID, "role": {"enum": ["customer", "admin"]}, "disabled": {"type": "boolean"}},
        ["userId", "role", "disabled"],
        strict({"user": strict({"id": {"type": "string"}, "email": {"type": "string"}, "name": {"type": "string"},
                                "role": {"type": "string"}, "disabled": {"type": "boolean"}},
                               ["id", "email", "name", "role", "disabled"])}, ["user"]),
        lambda args: ("PATCH", "/api/admin/users/" + args["userId"], None, {"role": args["role"], "disabled": args["disabled"]}),
        lambda data, args: {"user": {k: data["user"][k] for k in ("id", "email", "name", "role", "disabled")}},
        roles=SUPERADMIN, write=True, destructive=True, idempotent=True,
        confirm=lambda a: f"Set account {a['userId']} to role {a['role']} and disabled={a['disabled']}?",
    ),
    ToolSpec(
        "admin_get_settings", "Super admin: read settings",
        "Super admin: read the public store settings (name, announcement, support email, checkout switch). No secrets.",
        {}, (), SETTINGS,
        lambda args: ("GET", "/api/admin/settings", None, None),
        lambda data, args: {k: data[k] for k in ("storeName", "announcement", "supportEmail", "checkoutEnabled")},
        roles=SUPERADMIN,
    ),
    ToolSpec(
        "admin_update_settings", "Super admin: update settings",
        "Super admin: replace the public store settings. Cannot read or change secrets or payment keys. "
        "checkoutEnabled=false stops new checkouts. Requires human confirmation.",
        SETTINGS["properties"], SETTINGS["required"], SETTINGS,
        lambda args: ("PUT", "/api/admin/settings", None, args),
        lambda data, args: {k: data[k] for k in ("storeName", "announcement", "supportEmail", "checkoutEnabled")},
        roles=SUPERADMIN, write=True, destructive=True, idempotent=True,
        confirm=lambda a: (f"Update store settings: name '{a['storeName']}', checkout "
                           f"{'enabled' if a['checkoutEnabled'] else 'DISABLED'}?"),
    ),
]
BY_NAME = {spec.name: spec for spec in TOOLS}


def _admin_products(data, args):
    rows = sorted((p for p in data["products"] if isinstance(p, dict) and isinstance(p.get("sku"), str)),
                  key=lambda p: p["sku"])
    if "after" in args:
        rows = [p for p in rows if p["sku"] > args["after"]]
    limit = args.get("limit", 50)
    page = [{
        "sku": p["sku"], "name": _text(p.get("name")) or p["sku"], "price": _number(p.get("price")),
        "currency": _text(p.get("currency")), "priceType": _text(p.get("priceType")),
        "instock": _integer(p.get("instock")), "available": _integer(p.get("available")),
        "archived": p.get("archived") is True, "revision": _integer(p.get("revision")),
        "categories": [c for c in p.get("categories", []) if isinstance(c, str)][:50],
    } for p in rows[:limit]]
    return {"products": page, "stockEditable": data.get("stockEditable") is not False,
            "nextAfter": page[-1]["sku"] if len(rows) > limit else None}


def validate(value, schema):
    """Strict argument check: no coercion, no unknown fields, bounded sizes."""
    type_ = schema.get("type")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError("Invalid choice.")
    if type_ is None:
        return
    valid = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": type(value) is int,
        "number": type(value) in (int, float),
        "boolean": type(value) is bool,
    }.get(type_, False)
    if not valid:
        raise ValueError("Invalid argument type.")
    if type_ == "object":
        if set(value) - set(schema["properties"]) or set(schema.get("required", [])) - set(value):
            raise ValueError("Invalid argument fields.")
        for k, v in value.items():
            validate(v, schema["properties"][k])
    if type_ == "string" and (
        not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 1000)
        or ("pattern" in schema and not re.search(schema["pattern"], value))
        or any(ord(c) < 32 for c in value)
    ):
        raise ValueError("Invalid string.")
    if type_ in ("number", "integer") and (
        not math.isfinite(value)
        or value < schema.get("minimum", -math.inf)
        or value > schema.get("maximum", math.inf)
    ):
        raise ValueError("Invalid number.")
    if type_ == "array":
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 50):
            raise ValueError("Invalid array size.")
        for item in value:
            validate(item, schema["items"])
        if schema.get("uniqueItems") and len(set(value)) != len(value):
            raise ValueError("Duplicate items.")
