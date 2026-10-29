"""Trace continuity across the real HTTP transport, FastMCP's tool span and gateway client spans."""
import os
import unittest
from unittest.mock import patch

from support import FixtureGateway, token, http_app, http_client, gateway_for, create_server
from fastmcp import Client
from otel_bridge import configure

TRACE, PARENT = "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"


class Tracing(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        configure()
        self.fixture, self.spans = FixtureGateway(), []
        record = lambda service, context, start, name, status: self.spans.append(
            {"name": name, "kind": context.get("kind", 2), "traceId": context["traceId"], "spanId": context["spanId"],
             "parent": context.get("parentSpanId"), "attributes": dict(context.get("attributes", {})), "status": status})
        self.patchers = [patch(target, side_effect=record) for target in ("otel_bridge.telemetry", "runtime.telemetry")]
        for patcher in self.patchers:
            patcher.start()
        self.addCleanup(lambda: [p.stop() for p in self.patchers])

    async def call(self, flags="01", query="private shopper intent"):
        async with http_app(self.fixture) as app:
            async with http_client(app, token("customer"), headers={"traceparent": f"00-{TRACE}-{PARENT}-{flags}"}) as client:
                self.spans.clear()
                self.fixture.requests.clear()
                return await client.call_tool("search_products", {"query": query})

    async def test_transport_tool_and_gateway_spans_form_one_connected_trace(self):
        await self.call()
        ours = [s for s in self.spans if s["traceId"] == TRACE]
        by_id = {s["spanId"]: s for s in ours}
        tools = [s for s in ours if s["name"] == "mcp.call_tool" and s["kind"] == 2]
        self.assertEqual(len(tools), 1, "exactly one server tool span per call")
        tool = tools[0]
        self.assertEqual(tool["attributes"]["gen_ai.tool.name"], "search_products")
        self.assertEqual(tool["attributes"]["mcp.tool.outcome"], "success")
        transport = by_id[tool["parent"]]
        self.assertEqual((transport["name"], transport["parent"]), ("POST /mcp", PARENT))
        gateway = [s for s in ours if s["name"] == "GET /api/recommendations"]
        self.assertEqual(len(gateway), 1)
        self.assertEqual((gateway[0]["kind"], gateway[0]["parent"]), (3, tool["spanId"]))
        received = [r[2] for r in self.fixture.requests if r[1] == "/api/recommendations"]
        self.assertEqual(received, [f"00-{TRACE}-{gateway[0]['spanId']}-01"])
        # Session verification happens inside the same transport span, not in a detached trace.
        auth = [s for s in ours if s["name"] == "GET /api/auth/me" and s["parent"] == transport["spanId"]]
        self.assertEqual(len(auth), 1)
        self.assertNotIn("private shopper", str(self.spans))
        self.assertTrue(all(s["name"] in ("POST /mcp", "mcp.call_tool", "mcp.list_tools", "mcp.initialize", "mcp.request")
                            or s["name"].startswith("GET /api/") for s in self.spans), {s["name"] for s in self.spans})

    async def test_unsampled_requests_propagate_but_export_nothing(self):
        captured = []
        for patcher in self.patchers:  # Use the real exporters; only the OTLP POST is captured.
            patcher.stop()
        self.patchers = []
        traced = lambda payload: [span["traceId"] for r in payload["resourceSpans"] for sc in r["scopeSpans"] for span in sc["spans"]]
        # Run exports inline and keep only spans from this request's trace (the in-process
        # test client also creates its own, independently sampled root spans).
        with patch("runtime.exports.submit", side_effect=lambda fn, *a: fn(*a)), \
                patch("runtime._request", side_effect=lambda url, payload, *a, **k: captured.extend(t for t in traced(payload) if t == TRACE)), \
                patch.dict(os.environ, {"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://collector.invalid/v1/traces"}):
            await self.call(flags="00")
            self.assertEqual(captured, [])
            await self.call(flags="01")
            self.assertTrue(captured, "sampled requests do export")
            captured.clear()
            await self.call(flags="00")
        self.assertEqual(captured, [])
        received = [r[2] for r in self.fixture.requests if r[1] == "/api/recommendations"]
        self.assertTrue(received[0].startswith(f"00-{TRACE}-") and received[0].endswith("-00"))

    async def test_telemetry_failure_or_disabled_sdk_never_fails_a_tool(self):
        with patch("otel_bridge.telemetry", side_effect=RuntimeError("collector down")), \
                patch("runtime.telemetry", side_effect=RuntimeError("collector down")):
            result = await self.call()
        self.assertFalse(result.is_error)
        with patch.dict(os.environ, {"OTEL_SDK_DISABLED": "true", "MCP_SESSION_TOKEN": token("customer")}):
            async with Client(create_server(gateway=gateway_for(self.fixture))) as client:
                self.assertFalse((await client.call_tool("view_cart", {})).is_error)


if __name__ == "__main__":
    unittest.main()
