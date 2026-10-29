"""Exercise the real FastMCP client/server boundary; only the gateway is synthetic."""
import asyncio
import io
import os
import sys
import time
import unittest
from unittest.mock import patch

from support import FixtureGateway, token, gateway_for, http_app, http_client, raw_client, create_server, SERVICE
import anyio
import server as mcp_server
from fastmcp import Client
from fastmcp.exceptions import ToolError
from confirmation import Confirmations, ConfirmationError
from gateway_tools import TOOLS
from runtime import log_event

CUSTOMER, OTHER, ADMIN, OWNER = token("customer"), token("customer-2"), token("admin"), token("superadmin")
READ_TOOLS = {s.name for s in TOOLS if not s.confirm}


def structured_error(result):
    return result.structured_content["error"]


class Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fixture = FixtureGateway()
        self.env = patch.dict(os.environ, {"MCP_SESSION_TOKEN": CUSTOMER})
        self.env.start()
        self.addCleanup(self.env.stop)

    def stdio_server(self, **kwargs):
        return create_server(gateway=gateway_for(self.fixture), **kwargs)

    def calls(self, path, method=None):
        return [r for r in self.fixture.requests if r[1] == path and (method is None or r[0] == method)]


class DiscoveryAndContracts(Base):
    async def test_default_discovery_is_read_mostly_with_strict_documented_contracts(self):
        async with Client(self.stdio_server()) as client:
            tools = {t.name: t for t in await client.list_tools()}
        self.assertEqual(set(tools), READ_TOOLS)
        self.assertEqual(len(tools), 11)
        for t in tools.values():
            self.assertFalse(t.input_schema["additionalProperties"])
            self.assertEqual(t.output_schema["type"], "object")
            self.assertFalse(t.annotations.open_world_hint)
            self.assertGreater(len(t.description), 40)
        self.assertTrue(tools["search_products"].annotations.read_only_hint)
        cart = tools["update_cart"].annotations
        self.assertEqual((cart.read_only_hint, cart.destructive_hint, cart.idempotent_hint), (False, True, True))
        self.assertEqual(tools["shipping_cities"].input_schema["properties"]["country"]["pattern"], "^[A-Z]{2}$")
        async with Client(self.stdio_server(admin_writes=True)) as client:
            tools = {t.name: t for t in await client.list_tools()}
        self.assertEqual(len(tools), 15)
        self.assertFalse(tools["admin_create_product"].annotations.destructive_hint)
        self.assertFalse(tools["admin_create_product"].annotations.idempotent_hint)

    async def test_search_and_compare_return_catalogue_evidence_and_provenance(self):
        async with Client(self.stdio_server()) as client:
            found = (await client.call_tool("search_products", {"query": "inspection robot", "limit": 5})).structured_content
            rover = next(p for p in found["products"] if p["sku"] == "DEMO-ROVER-1")
            self.assertEqual((rover["currency"], rover["priceType"], rover["inStock"]), ("INR", "sale", 5))
            self.assertEqual(rover["provenance"]["demo"], True)
            self.assertEqual(rover["provenance"]["fulfilment"], "simulated")
            reference = next(p for p in found["products"] if p["sku"] == "REF-QUAD-4")
            self.assertEqual((reference["inStock"], reference["priceType"]), (0, "reference"))  # zero, not missing
            self.assertEqual(reference["provenance"]["sources"][0]["url"], "https://example.com/quadruped")
            self.assertTrue(found["observedAt"].endswith("Z"))
            same = (await client.call_tool("compare_products", {"skus": ["DEMO-ROVER-1", "DEMO-CRAWLER-2"]})).structured_content
            self.assertEqual((same["comparable"], same["lowestPrice"], same["currency"]), (True, 52999, "INR"))
            mixed = (await client.call_tool("compare_products", {"skus": ["DEMO-ROVER-1", "REF-QUAD-4"]})).structured_content
            self.assertEqual((mixed["comparable"], mixed["lowestPrice"], mixed["currency"]), (False, None, None))
            empty = await client.call_tool("search_products", {"query": "submarine"})
            self.assertFalse(empty.is_error)
            self.assertEqual((empty.structured_content["products"], empty.structured_content["resultCount"]), ([], 0))
            missing = await client.call_tool("compare_products", {"skus": ["DEMO-ROVER-1", "NOPE"]}, raise_on_error=False)
            self.assertEqual(structured_error(missing)["code"], "not_found")

    async def test_invalid_arguments_never_reach_the_gateway(self):
        async with Client(self.stdio_server()) as client:
            for name, args in [("compare_products", {"skus": ["RED", "RED"]}), ("search_products", {"query": "x", "url": "http://evil"}),
                               ("update_cart", {"sku": "X", "quantity": True}), ("update_cart", {"sku": "../admin", "quantity": 1}),
                               ("update_cart", {"sku": "X", "quantity": 1, "userId": "00000000-0000-4000-8000-000000000002"}),
                               ("shipping_cities", {"country": "india", "q": "be"}), ("search_products", {"query": "a\nb"}),
                               ("search_products", {"query": "x" * 301})]:
                result = await client.call_tool(name, args, raise_on_error=False)
                self.assertEqual(structured_error(result)["code"], "invalid_argument", (name, args))
            with self.assertRaises(Exception):
                await client.call_tool("execute_shell", {})
        self.assertEqual(self.fixture.requests, [])


class Authorization(Base):
    async def test_discovery_is_filtered_by_role_and_execution_still_checked(self):
        async with http_app(self.fixture) as app:
            visible = {}
            for name, bearer in (("customer", CUSTOMER), ("admin", ADMIN), ("owner", OWNER)):
                async with http_client(app, bearer) as client:
                    visible[name] = {t.name for t in await client.list_tools()}
            self.assertNotIn("admin_list_products", visible["customer"])
            self.assertIn("view_cart", visible["customer"])
            self.assertIn("admin_list_products", visible["admin"])
            self.assertNotIn("admin_list_users", visible["admin"])
            self.assertEqual(visible["owner"], READ_TOOLS)
            async with http_client(app, CUSTOMER) as client:
                with self.assertRaises(Exception):
                    await client.call_tool("admin_list_users", {})
        self.assertEqual(self.calls("/api/admin/users"), [])
        # stdio has no discovery filtering: the gateway is the authoritative check.
        async with Client(self.stdio_server()) as client:
            denied = await client.call_tool("admin_list_users", {}, raise_on_error=False)
        self.assertEqual(structured_error(denied)["code"], "forbidden")
        self.assertEqual(len(self.calls("/api/admin/users")), 1)

    async def test_http_requires_a_live_session_without_environment_fallback(self):
        async with http_app(self.fixture) as app, raw_client(app) as http:
            self.assertEqual((await http.post("/mcp", json={})).status_code, 401)
            self.assertEqual((await http.post("/mcp", json={}, headers={"Authorization": "Bearer not-a-token"})).status_code, 401)
            revoked = token("customer-2")
            self.fixture.users[revoked]["disabled"] = True
            self.assertEqual((await http.post("/mcp", json={}, headers={"Authorization": "Bearer " + revoked})).status_code, 401)
            self.assertEqual((await http.get("/health")).status_code, 200)
        self.assertNotIn(CUSTOMER, str([r for r in self.fixture.requests if r[1] != "/api/auth/me"]))

    async def test_concurrent_users_only_reach_their_own_carts(self):
        async with http_app(self.fixture) as app:
            async def shop(bearer, sku, qty):
                async with http_client(app, bearer, headers={"Cookie": "rs_auth=" + OWNER, "X-Forwarded-For": "1.2.3.4"}) as client:
                    await client.call_tool("update_cart", {"sku": sku, "quantity": qty})
                    return (await client.call_tool("view_cart", {})).structured_content
            mine, theirs = await asyncio.gather(shop(CUSTOMER, "DEMO-ROVER-1", 1), shop(OTHER, "DEMO-ARM-3", 2))
        self.assertEqual([i["sku"] for i in mine["items"]], ["DEMO-ROVER-1"])
        self.assertEqual([i["sku"] for i in theirs["items"]], ["DEMO-ARM-3"])
        self.assertNotIn(OWNER, str(self.fixture.carts))
        self.assertEqual(set(self.fixture.carts), {"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"})


class Writes(Base):
    async def test_cart_conflicts_and_duplicate_submissions_are_not_retried(self):
        async with Client(self.stdio_server()) as client:
            for _ in range(2):  # Set-quantity semantics: a duplicate has no further effect.
                cart = (await client.call_tool("update_cart", {"sku": "DEMO-ROVER-1", "quantity": 2})).structured_content
            self.assertEqual(cart["items"][0]["quantity"], 2)
            self.assertEqual(cart["shippingCost"], None)  # not selected, not free
            stock = await client.call_tool("update_cart", {"sku": "DEMO-ROVER-1", "quantity": 9}, raise_on_error=False)
            self.assertEqual(structured_error(stock)["code"], "conflict")
            self.assertIn("exceeds available stock", structured_error(stock)["detail"])
            self.fixture.pending.add("00000000-0000-4000-8000-000000000001")
            pending = await client.call_tool("update_cart", {"sku": "DEMO-ARM-3", "quantity": 1}, raise_on_error=False)
            self.assertEqual(structured_error(pending)["code"], "conflict")
            self.fixture.faults["/api/cart"] = [503]
            failed = await client.call_tool("update_cart", {"sku": "DEMO-ARM-3", "quantity": 1}, raise_on_error=False)
            self.assertEqual((structured_error(failed)["code"], structured_error(failed)["retryable"]), ("dependency_unavailable", False))
        self.assertEqual(len(self.calls("/api/cart", "POST")), 5)  # one gateway request per call, never replayed

    async def test_admin_writes_require_identity_bound_confirmation(self):
        product = {"sku": "DEMO-NEW-5", "name": "New (synthetic)", "description": "Synthetic", "price": 10, "instock": 1, "categories": ["robot"]}
        answers = []

        async def accept(message, response_type, params, context):
            answers.append(message)
            return {"confirm": True}

        async def decline(message, response_type, params, context):
            return {"confirm": False}

        os.environ["MCP_SESSION_TOKEN"] = ADMIN
        server = self.stdio_server(admin_writes=True)
        async with Client(server) as client:  # no elicitation support: fails closed
            with self.assertRaises(Exception):
                await client.call_tool("admin_create_product", product)
        async with Client(server, elicitation_handler=decline) as client:
            declined = await client.call_tool("admin_create_product", product, raise_on_error=False)
            self.assertEqual(structured_error(declined)["code"], "confirmation_declined")
        self.assertEqual(self.calls("/api/admin/products", "POST"), [])
        async with Client(server, elicitation_handler=accept) as client:
            self.assertTrue((await client.call_tool("admin_create_product", product)).structured_content["saved"])
            duplicate = await client.call_tool("admin_create_product", product, raise_on_error=False)
            self.assertEqual(structured_error(duplicate)["code"], "conflict")
            stale = await client.call_tool("admin_update_product", product | {"archived": False, "revision": 7}, raise_on_error=False)
            self.assertEqual(structured_error(stale)["code"], "conflict")
        self.assertIn("DEMO-NEW-5", answers[0])
        self.assertEqual(len(self.calls("/api/admin/products", "POST")), 2)

    def test_confirmation_state_is_bound_to_identity_arguments_and_single_use(self):
        confirmations = Confirmations(ttl=60)
        state = confirmations._state("user-1", "admin_update_settings", {"storeName": "A"})
        with self.assertRaises(ConfirmationError):
            confirmations._consume(state, "user-2", "admin_update_settings", {"storeName": "A"})
        with self.assertRaises(ConfirmationError):
            confirmations._consume(state, "user-1", "admin_update_settings", {"storeName": "B"})
        with self.assertRaises(ConfirmationError):
            confirmations._consume(state.replace('"exp":', '"exp":1'), "user-1", "admin_update_settings", {"storeName": "A"})
        confirmations._consume(state, "user-1", "admin_update_settings", {"storeName": "A"})
        with self.assertRaises(ConfirmationError):
            confirmations._consume(state, "user-1", "admin_update_settings", {"storeName": "A"})


class Reliability(Base):
    async def test_reads_retry_once_within_deadline_and_timeouts_are_bounded(self):
        self.fixture.faults["/api/compare"] = ["connect"]
        self.fixture.faults["/api/shipping/countries"] = [503]
        async with Client(self.stdio_server()) as client:
            self.assertFalse((await client.call_tool("compare_products", {"skus": ["DEMO-ROVER-1", "DEMO-ARM-3"]})).is_error)
            self.assertFalse((await client.call_tool("shipping_countries", {})).is_error)
            self.fixture.faults["/api/recommendations"] = ["slow", "slow"]
            with patch.object(mcp_server, "TOOL_DEADLINE", 0.5):
                started = time.monotonic()
                slow = await client.call_tool("search_products", {"query": "robot"}, raise_on_error=False)
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual((structured_error(slow)["code"], structured_error(slow)["retryable"]), ("timeout", True))
        self.assertEqual(len(self.calls("/api/shipping/countries")), 2)

    async def test_cancelled_mutation_completes_once_and_is_not_replayed(self):
        self.fixture.faults["/api/cart"] = [0.3]
        async with Client(self.stdio_server()) as client:
            with self.assertRaises(Exception):
                await client.call_tool("update_cart", {"sku": "DEMO-ARM-3", "quantity": 1}, timeout=0.05)
            await asyncio.sleep(0.6)
        self.assertEqual([r[4] for r in self.calls("/api/cart", "POST")], [True])
        self.assertEqual(self.fixture.carts["00000000-0000-4000-8000-000000000001"], {"DEMO-ARM-3": 1})

    async def test_throttling_and_downstream_failures_are_classified_and_safe(self):
        server = self.stdio_server()
        async with Client(server) as client:
            cases = [([429], "rate_limited"), (["garbage"], "invalid_response"), (["huge"], "invalid_response"),
                     ([503, 500], "dependency_unavailable"), ([401], "unauthenticated")]
            for faults, code in cases:
                self.fixture.faults["/api/shipping/countries"] = list(faults)
                result = await client.call_tool("shipping_countries", {}, raise_on_error=False)
                self.assertEqual(structured_error(result)["code"], code)
                self.assertNotIn("10.0.0.7", str(result.content) + str(result.structured_content))
                self.assertNotIn("Traceback", str(result.content))
            with patch.object(mcp_server.Admission, "enter", return_value=False):
                busy = await client.call_tool("shipping_countries", {}, raise_on_error=False)
            self.assertEqual(structured_error(busy)["code"], "rate_limited")
            self.assertRegex(structured_error(busy).get("correlationId", "") or "", r"^([a-f0-9]{32})?$")

    def test_admission_limits_each_identity_and_total_in_flight(self):
        admission = mcp_server.Admission(per_minute=2, in_flight=3)
        self.assertTrue(admission.enter("a") and admission.enter("a"))
        self.assertFalse(admission.enter("a"))
        self.assertTrue(admission.enter("b"))
        self.assertFalse(admission.enter("c"))  # three calls already in flight
        admission.leave()
        self.assertTrue(admission.enter("c"))

    async def test_logs_never_contain_sessions_or_arguments(self):
        with patch("sys.stderr", new_callable=io.StringIO) as err:
            async with Client(self.stdio_server()) as client:
                await client.call_tool("search_products", {"query": "very private shopping intent"})
                await client.call_tool("update_cart", {"sku": "DEMO-ROVER-1", "quantity": 99}, raise_on_error=False)
        logs = err.getvalue()
        self.assertIn("mcp_tool_completed", logs)
        for secret in (CUSTOMER, "very private", "rs_auth"):
            self.assertNotIn(secret, logs)


class Transport(Base):
    async def test_host_origin_body_limits_and_kubelet_probe_host(self):
        async with http_app(self.fixture) as app:
            async with raw_client(app) as http:
                self.assertEqual((await http.get("/health", headers={"Host": "evil.example"})).status_code, 421)
                self.assertEqual((await http.post("/mcp", json={}, headers={"Origin": "https://evil.example", "Authorization": "Bearer " + CUSTOMER})).status_code, 403)
                big = await http.post("/mcp", content=b"{" + b" " * 300000 + b"}", headers={"Authorization": "Bearer " + CUSTOMER, "content-type": "application/json"})
                self.assertEqual(big.status_code, 413)
            async with raw_client(app, base="http://10.244.0.17:4107") as probe:  # kubelet uses the pod IP
                self.assertEqual((await probe.get("/health")).status_code, 200)
            async with raw_client(app, base="http://mcp-server.roboshop-ai.svc.cluster.local:4107") as cluster:
                self.assertEqual((await cluster.get("/health")).status_code, 200)

    async def test_readiness_is_bounded_and_independent_of_liveness(self):
        self.fixture.faults["/health/ready"] = ["slow"]
        async with http_app(self.fixture) as app, raw_client(app) as http:
            started = time.monotonic()
            self.assertEqual((await http.get("/ready")).status_code, 503)
            self.assertLess(time.monotonic() - started, 3)
            self.assertEqual((await http.get("/health")).status_code, 200)

    async def test_real_stdio_process_keeps_stdout_for_protocol_messages(self):
        from fastmcp.client.transports import PythonStdioTransport
        transport = PythonStdioTransport(str(SERVICE / "server.py"), python_cmd=sys.executable,
                                         env={"MCP_TRANSPORT": "stdio", "GATEWAY_URL": "http://127.0.0.1:9", "OTEL_SDK_DISABLED": "true"})
        async with Client(transport) as client:
            self.assertEqual(len(await client.list_tools()), 11)
            down = await client.call_tool("shipping_countries", {}, raise_on_error=False)
            self.assertEqual(structured_error(down)["code"], "dependency_unavailable")
        with patch("sys.stdout", new_callable=io.StringIO) as out, patch("sys.stderr", new_callable=io.StringIO) as err:
            log_event("mcp_test")
        self.assertEqual(out.getvalue(), "")
        self.assertIn("mcp_test", err.getvalue())


if __name__ == "__main__":
    unittest.main()
