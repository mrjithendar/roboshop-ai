"""Reproducible MCP demo: a real MCP client over Streamable HTTP to the real server process.

Path exercised: this script (FastMCP client) -> mcp-server (separate process, HTTP /mcp)
-> gateway. By default the gateway is the synthetic fixture in fixture_gateway.py, which also
collects the server's OTLP spans so the connected trace can be printed. No real accounts,
payments or language models are used.

    python services/mcp-server/demo/demo.py
    ROBOSHOP_DEMO_SESSION=<rs_auth of a test customer> python services/mcp-server/demo/demo.py --gateway http://localhost:3000
"""
import argparse
import asyncio
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path

DEMO = Path(__file__).resolve().parent
SERVICE = DEMO.parent
sys.path[:0] = [str(DEMO)]
import httpx2
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fixture_gateway import FixtureGateway, ORIGIN


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def show(title, value):
    print(f"\n== {title}")
    print(value if isinstance(value, str) else json.dumps(value, indent=2)[:1800])


def trace_tree(fixture, trace_id):
    spans = {}
    for batch in fixture.spans:
        for resource in batch["resourceSpans"]:
            service = next(a["value"]["stringValue"] for a in resource["resource"]["attributes"] if a["key"] == "service.name")
            for scope in resource["scopeSpans"]:
                for span in scope["spans"]:
                    if span["traceId"] == trace_id:
                        spans[span["spanId"]] = span | {"service": service}
    kinds = {1: "internal", 2: "server", 3: "client"}
    lines = []

    def walk(parent, depth):
        for span in sorted((s for s in spans.values() if s.get("parentSpanId") == parent), key=lambda s: s["startTimeUnixNano"]):
            attrs = {a["key"]: next(iter(a["value"].values())) for a in span["attributes"]}
            extra = " ".join(f"{k}={attrs[k]}" for k in ("gen_ai.tool.name", "mcp.tool.outcome") if k in attrs)
            lines.append(f"{'  ' * depth}{span['service']}: {span['name']} [{kinds.get(span['kind'], span['kind'])}] {extra}".rstrip())
            walk(span["spanId"], depth + 1)
    roots = {s.get("parentSpanId") for s in spans.values()} - set(spans)
    for root in roots:
        lines.append(f"(caller span {root})")
        walk(root, 1)
    return "\n".join(lines) or "(no spans received; is OpenTelemetry disabled?)"


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gateway", help="Use a running RoboShop gateway instead of the synthetic fixture.")
    options = parser.parse_args()
    fixture = None
    if options.gateway:
        gateway, session = options.gateway.rstrip("/"), os.environ.get("ROBOSHOP_DEMO_SESSION", "")
        if not session:
            raise SystemExit("Set ROBOSHOP_DEMO_SESSION to a test customer's rs_auth session; it is never taken from arguments.")
        origin = os.environ.get("PUBLIC_ORIGIN", gateway)
    else:
        fixture = FixtureGateway()
        listener = fixture.serve()
        gateway, origin = f"http://127.0.0.1:{listener.server_address[1]}", ORIGIN
        print("PATH: demo MCP client -> mcp-server process (Streamable HTTP) -> synthetic fixture gateway")
        async with httpx2.AsyncClient(base_url=gateway) as http:
            login = await http.post("/api/auth/login", json={"email": "ada.customer@example.test", "password": "synthetic-demo-password"},
                                    headers={"origin": ORIGIN})
            session = login.json()["session"]
        show("Authenticated synthetic customer", f"{login.json()['user']['name']} (role customer); session kept in memory only")

    port = free_port()
    env = {**os.environ, "MCP_TRANSPORT": "http", "HOST": "127.0.0.1", "PORT": str(port), "GATEWAY_URL": gateway,
           "PUBLIC_ORIGIN": origin, "LOG_LEVEL": "WARN", "OTEL_SERVICE_NAME": "mcp-server"}
    if fixture:
        env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = gateway + "/v1/traces"
    process = subprocess.Popen([sys.executable, str(SERVICE / "server.py")], env=env)
    try:
        async with httpx2.AsyncClient() as http:
            for _ in range(100):
                try:
                    if (await http.get(f"http://127.0.0.1:{port}/health")).status_code == 200:
                        break
                except httpx2.TransportError:
                    await asyncio.sleep(0.1)
            else:
                raise SystemExit("mcp-server did not start")
        trace_id = secrets.token_hex(16)
        headers = {"Authorization": "Bearer " + session, "traceparent": f"00-{trace_id}-{secrets.token_hex(8)}-01"}
        async with Client(StreamableHttpTransport(f"http://127.0.0.1:{port}/mcp", headers=headers)) as client:
            tools = await client.list_tools()
            show("Tools this customer may discover", [t.name for t in tools])
            found = (await client.call_tool("search_products", {"query": "inspection robot", "limit": 4})).structured_content
            show("search_products 'inspection robot'", [
                {k: p[k] for k in ("sku", "name", "price", "currency", "priceType", "inStock")} | {"collection": p["provenance"]["collection"]}
                for p in found["products"]])
            skus = [p["sku"] for p in found["products"]][:2]
            compared = (await client.call_tool("compare_products", {"skus": skus})).structured_content
            show(f"compare_products {skus}", {k: compared[k] for k in ("currency", "lowestPrice", "comparable", "priceComparisonPolicy")})
            try:
                denied = await client.call_tool("admin_list_users", {}, raise_on_error=False)
                show("admin_list_users as customer", denied.content[0].text)
            except Exception as error:
                show("admin_list_users as customer (denied by the MCP server before any gateway call)", f"{type(error).__name__}: {error}")
        if fixture:
            await asyncio.sleep(1.5)  # Exports are asynchronous.
            show(f"Trace {trace_id}", trace_tree(fixture, trace_id))
            received = sorted({r[1] for r in fixture.requests if (r[2] or "").split("-")[1:2] == [trace_id]})
            show("Gateway requests that carried this trace", received)
        else:
            show("Trace", f"Look up trace {trace_id} in your tracing backend.")
    finally:
        process.terminate()
        process.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
