"""Stdio MCP bridge. All mutations go through gateway authorization."""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python-common"))
from runtime import upstream, HttpError, trace_span, configure_telemetry

STRING = {"type": "string", "maxLength": 1000}
SKU = {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$"}


def tool(name, description, properties=None, required=(), write=False):
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties or {},
            "required": list(required),
            "additionalProperties": False,
        },
        "annotations": {
            "readOnlyHint": not write,
            "destructiveHint": write,
            "idempotentHint": not write,
            "openWorldHint": False,
        },
    }


PRODUCT = {
    "sku": SKU,
    "name": {"type": "string", "maxLength": 200},
    "description": {"type": "string", "maxLength": 3000},
    "price": {"type": "number", "minimum": 0, "maximum": 1000000},
    "instock": {"type": "integer", "minimum": 0},
    "categories": {
        "type": "array",
        "items": {"type": "string", "maxLength": 100},
        "minItems": 1,
        "maxItems": 50,
    },
    "archived": {"type": "boolean"},
}
TOOLS = [
    tool(
        "search_products",
        "Search current catalogue recommendations.",
        {"query": STRING},
        ["query"],
    ),
    tool("service_health", "Read service health and runbook suggestions."),
    tool(
        "compare_products",
        "Compare 2–4 catalogue products, including current availability.",
        {
            "skus": {
                "type": "array",
                "items": SKU,
                "minItems": 2,
                "maxItems": 4,
                "uniqueItems": True,
            }
        },
        ["skus"],
    ),
    tool("shipping_countries", "List supported shipping countries."),
    tool(
        "shipping_cities",
        "Search cities in a shipping country.",
        {
            "country": {"type": "string", "maxLength": 100},
            "q": {"type": "string", "maxLength": 100},
        },
        ["country"],
    ),
    tool(
        "personalized_recommendations",
        "Read recommendations based on the authenticated account cart.",
    ),
    tool("view_cart", "Read the authenticated account cart."),
    tool(
        "update_cart",
        "Set a SKU quantity (0 removes it) in the authenticated account cart. Does not place an order.",
        {"sku": SKU, "quantity": {"type": "integer", "minimum": 0, "maximum": 20}},
        ["sku", "quantity"],
        True,
    ),
    tool("admin_list_products", "Admin: list products with revision numbers."),
    tool(
        "admin_create_product",
        "Admin: create a product. Requires explicit user intent.",
        PRODUCT,
        list(PRODUCT)[:-1],
        True,
    ),
    tool(
        "admin_update_product",
        "Admin: update a product using its current revision; stale edits are rejected.",
        PRODUCT | {"revision": {"type": "integer", "minimum": 1}},
        list(PRODUCT) + ["revision"],
        True,
    ),
    tool(
        "admin_list_users",
        "Super admin: list users and roles, without password hashes.",
        {"after": {"type": "string", "maxLength": 100}},
    ),
    tool(
        "admin_set_user_access",
        "Super admin: change a customer/admin role or disabled status. The single super admin is protected.",
        {
            "userId": {"type": "string", "pattern": "^[a-f0-9-]{36}$"},
            "role": {"type": "string", "enum": ["customer", "admin"]},
            "disabled": {"type": "boolean"},
        },
        ["userId", "role", "disabled"],
        True,
    ),
    tool("admin_get_settings", "Super admin: read public store settings."),
    tool(
        "admin_update_settings",
        "Super admin: update public store settings. Cannot edit secrets.",
        {
            "storeName": {"type": "string", "maxLength": 60},
            "announcement": {"type": "string", "maxLength": 160},
            "supportEmail": {"type": "string", "maxLength": 254},
            "checkoutEnabled": {"type": "boolean"},
        },
        ["storeName", "announcement", "supportEmail", "checkoutEnabled"],
        True,
    ),
]


def validate(value, schema):
    type_ = schema.get("type")
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
        if set(value) - set(schema["properties"]) or set(
            schema.get("required", [])
        ) - set(value):
            raise ValueError("Invalid argument fields.")
        for k, v in value.items():
            validate(v, schema["properties"][k])
    if type_ == "string" and (
        len(value) > schema.get("maxLength", 1000)
        or ("pattern" in schema and not re.fullmatch(schema["pattern"], value))
    ):
        raise ValueError("Invalid string.")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError("Invalid choice.")
    if type_ in ("number", "integer"):
        import math

        if (
            not math.isfinite(value)
            or value < schema.get("minimum", -float("inf"))
            or value > schema.get("maximum", float("inf"))
        ):
            raise ValueError("Invalid number.")
    if type_ == "array":
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 50):
            raise ValueError("Invalid array size.")
        for item in value:
            validate(item, schema["items"])
        if schema.get("uniqueItems") and len(set(value)) != len(value):
            raise ValueError("Duplicate items.")


class MCP:
    def __init__(self, fetcher=upstream):
        self.initialized = False
        self.fetcher = fetcher

    def call(self, name, args):
        protected = name.startswith("admin_") or name in (
            "view_cart",
            "update_cart",
            "personalized_recommendations",
        )
        session = os.getenv("MCP_SESSION_TOKEN", "")
        if protected and not re.fullmatch("[a-f0-9]{64}", session):
            raise HttpError(401, "Configure an authenticated MCP_SESSION_TOKEN.")
        headers = {"origin": os.getenv("PUBLIC_ORIGIN", "http://localhost:3000")}
        if protected:
            headers["cookie"] = "rs_auth=" + session
        routes = {
            "search_products": (
                "/api/recommendations?" + urlencode({"q": args.get("query", "")}),
                "GET",
                None,
            ),
            "service_health": ("/api/ops", "GET", None),
            "compare_products": (
                "/api/compare?" + urlencode({"skus": ",".join(args.get("skus", []))}),
                "GET",
                None,
            ),
            "shipping_countries": ("/api/shipping/countries", "GET", None),
            "shipping_cities": ("/api/shipping/cities?" + urlencode(args), "GET", None),
            "personalized_recommendations": (
                "/api/recommendations/personalized",
                "GET",
                None,
            ),
            "view_cart": ("/api/cart", "GET", None),
            "update_cart": ("/api/cart", "POST", args),
            "admin_list_products": ("/api/admin/products", "GET", None),
            "admin_create_product": ("/api/admin/products", "POST", args),
            "admin_update_product": (
                "/api/admin/products/" + args.get("sku", ""),
                "PUT",
                args,
            ),
            "admin_list_users": ("/api/admin/users?" + urlencode(args), "GET", None),
            "admin_set_user_access": (
                "/api/admin/users/" + args.get("userId", ""),
                "PATCH",
                {k: v for k, v in args.items() if k != "userId"},
            ),
            "admin_get_settings": ("/api/admin/settings", "GET", None),
            "admin_update_settings": ("/api/admin/settings", "PUT", args),
        }
        path, method, data = routes[name]
        return self.fetcher(
            os.getenv("GATEWAY_URL", "http://127.0.0.1:3000").rstrip("/") + path,
            data,
            headers,
            method=method,
        )

    def handle(self, message):
        id = message.get("id") if isinstance(message, dict) else None

        def error(code, text):
            return {
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": code, "message": text},
            }

        def reply(result):
            return {"jsonrpc": "2.0", "id": id, "result": result}

        if (
            not isinstance(message, dict)
            or message.get("jsonrpc") != "2.0"
            or not isinstance(message.get("method"), str)
        ):
            return error(-32600, "Invalid request")
        if "id" not in message:
            return None
        if type(id) not in (str, int) and id is not None:
            return error(-32600, "Invalid request ID")
        method = message["method"]
        if method == "initialize":
            params = message.get("params", {})
            if not isinstance(params, dict):
                return error(-32602, "Invalid params")
            version = params.get("protocolVersion", "2025-11-25")
            self.initialized = True
            return reply(
                {
                    "protocolVersion": (
                        version
                        if version
                        in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25")
                        else "2025-11-25"
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "robotshop", "version": "0.2.0"},
                }
            )
        if method == "ping":
            return reply({})
        if not self.initialized:
            return error(-32002, "Initialize first")
        if method == "tools/list":
            return reply({"tools": TOOLS})
        if method == "tools/call":
            params = message.get("params", {})
            if not isinstance(params, dict):
                return error(-32602, "Invalid params")
            spec = next((t for t in TOOLS if t["name"] == params.get("name")), None)
            if not spec:
                return error(-32602, "Unknown tool")
            try:
                args = params.get("arguments", {})
                validate(args, spec["inputSchema"])
                with trace_span(
                    "mcp.tool " + spec["name"],
                    service="mcp-server",
                    attributes={"rpc.system": "mcp", "mcp.tool.name": spec["name"]},
                ):
                    result = self.call(spec["name"], args)
                return reply(
                    {
                        "content": [{"type": "text", "text": json.dumps(result)}],
                        "isError": False,
                    }
                )
            except (ValueError, HttpError) as e:
                return reply(
                    {"content": [{"type": "text", "text": str(e)}], "isError": True}
                )
            except Exception:
                return reply(
                    {
                        "content": [{"type": "text", "text": "Tool unavailable."}],
                        "isError": True,
                    }
                )
        return error(-32601, "Method not found")


def main():
    configure_telemetry("mcp-server")
    server = MCP()
    while True:
        line = sys.stdin.buffer.readline(16386)
        if not line:
            break
        try:
            if len(line) > 16384:
                while line and not line.endswith(b"\n"):
                    line = sys.stdin.buffer.readline(16386)
                raise ValueError()
            response = server.handle(
                json.loads(
                    line, parse_constant=lambda _: (_ for _ in ()).throw(ValueError())
                )
            )
        except (ValueError, UnicodeError):
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }
        if response is not None:
            print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
