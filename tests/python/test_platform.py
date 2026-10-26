import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "services/user-service"))
sys.path[:0] = [
    str(ROOT / "services/ai-gateway/lib"),
    str(ROOT / "services/ai-gateway"),
    str(ROOT / "services/moks"),
]
from agent import answer
from catalogue import retrieve
from store import Store, cents
from accounts import hash_password, verify
from runtime import HttpError, application

PRODUCTS = json.loads(
    (ROOT / "tests/fixtures/catalogue/fictional-products.json").read_text()
)


class AgentTests(unittest.TestCase):
    def test_offline(self):
        result = answer(PRODUCTS, "security under 1000")
        self.assertEqual(result["mode"], "not-configured")
        self.assertEqual(result["products"], [])

    def test_unavailable_and_budget(self):
        self.assertEqual(retrieve(PRODUCTS, "security under 5"), [])
        self.assertTrue(all(p["instock"] > 0 for p in retrieve(PRODUCTS, "")))
        self.assertEqual(
            retrieve([p for p in PRODUCTS if p["sku"] != "RED"], "security under 1000"),
            [],
        )


class StoreTests(unittest.TestCase):
    @patch.dict(os.environ, {"CHECKOUT_CURRENCIES": "INR,USD,EUR"})
    def test_cart_ownership_and_payment(self):
        products = [dict(p, currency='INR') for p in PRODUCTS]
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            guest = store.session(None)
            store.update(guest, "RMC", 2, products)
            account = store.session(guest, "alice")
            self.assertNotEqual(account, guest)
            other = store.session(account, "bob")
            self.assertEqual(store.cart(other, products)["items"], [])
            from runtime import iso

            store.set_shipping(account, {"cost": 5, "currency":"INR", "quotedAt": iso()}, products)
            order = store.begin_payment(account, "a" * 20, products)
            self.assertEqual(
                store.begin_payment(account, "a" * 20, products)["id"], order["id"]
            )
            provider = {
                "orderId": "provider-1",
                "amount": cents(order["total"]),
                "currency": "INR",
            }
            store.attach_payment(order["id"], provider)
            with self.assertRaises(HttpError):
                store.mark_paid(
                    order["id"],
                    provider | {"verified": True, "paymentId": "p", "amount": 1},
                )
            paid = store.mark_paid(
                order["id"], provider | {"verified": True, "paymentId": "payment-1"}
            )
            self.assertEqual(paid["status"], "paid")
            self.assertEqual(len(store.pending_events()), 1)
            store.mark_paid(
                order["id"], provider | {"verified": True, "paymentId": "payment-1"}
            )
            self.assertEqual(store.state["testSold"]["RMC"], 2)
            saved_state = store.state
            store.close()
            store = Store(directory)
            self.assertEqual(store.state, saved_state)
            store.event_published(store.pending_events()[0]["eventId"])
            self.assertEqual(store.pending_events(), [])

    def test_password_compatibility(self):
        import subprocess

        encoded = subprocess.check_output(
            [
                "node",
                "--input-type=module",
                "-e",
                "import {scryptSync} from 'node:crypto'; console.log('scrypt:0123456789abcdef:'+scryptSync('long-test-password','0123456789abcdef',64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex'))",
            ],
            text=True,
        ).strip()
        self.assertTrue(verify("long-test-password", encoded))
        self.assertFalse(verify("wrong", encoded))
        self.assertTrue(
            verify("long-test-password", hash_password("long-test-password"))
        )


class RuntimeTests(unittest.TestCase):
    def test_trace_context_parent_sampling_and_no_arguments(self):
        import runtime

        captured = []
        with patch(
            "runtime.telemetry", side_effect=lambda *args: captured.append(args)
        ):
            with runtime.trace_span(
                "mcp.tool search_products",
                service="mcp-server",
                parent="00-" + "a" * 32 + "-" + "b" * 16 + "-00",
            ) as parent:
                with runtime.trace_span("HTTP GET", kind=3) as child:
                    self.assertEqual(child["traceId"], "a" * 32)
                    self.assertEqual(child["parentSpanId"], parent["spanId"])
                    self.assertEqual(child["flags"], "00")
                    self.assertEqual(child["attributes"], {})
            self.assertEqual(len(captured), 2)
        invalid = runtime.trace_context("00-" + "0" * 32 + "-" + "0" * 16 + "-01")
        self.assertNotEqual(invalid["traceId"], "0" * 32)
        self.assertNotIn("parentSpanId", invalid)

    def test_unsampled_spans_do_not_export(self):
        import runtime

        with patch.dict(
            os.environ,
            {
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://collector.invalid/v1/traces"
            },
        ), patch.object(runtime.exports, "submit") as submit:
            runtime.telemetry("test", {"flags": "00"}, 0, "HTTP GET", 200)
            submit.assert_not_called()

    def test_invalid_body_and_trace(self):
        app = application("test", lambda req: req.body())
        captured = {}

        def start(status, headers):
            captured.update(status=status, headers=dict(headers))

        with patch("runtime.telemetry"):
            result = app(
                {
                    "REQUEST_METHOD": "POST",
                    "PATH_INFO": "/api/chat",
                    "CONTENT_TYPE": "application/json",
                    "CONTENT_LENGTH": "2",
                    "wsgi.input": io.BytesIO(b"[]"),
                    "HTTP_TRACEPARENT": "00-" + "a" * 32 + "-" + "b" * 16 + "-01",
                },
                start,
            )
        self.assertTrue(captured["status"].startswith("400"))
        self.assertEqual(captured["headers"]["X-Request-ID"], "a" * 32)

    def test_http_error_does_not_expose_exception_message(self):
        def fail(req):
            raise HttpError(400, "internal details")

        app = application("test", fail)
        captured = {}

        def start(status, headers):
            captured.update(status=status, headers=dict(headers))

        with patch("runtime.telemetry"):
            result = app(
                {
                    "REQUEST_METHOD": "GET",
                    "PATH_INFO": "/api/chat",
                    "wsgi.input": io.BytesIO(b""),
                },
                start,
            )

        self.assertTrue(captured["status"].startswith("400"))
        self.assertNotIn(b"internal details", result[0])
        self.assertIn(b"The request could not be completed.", result[0])


if __name__ == "__main__":
    unittest.main()

class CurrencyTests(unittest.TestCase):
    def test_usd_cart_rejects_mixed_currency_and_foreign_shipping(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory)
            session=store.session(None)
            usd={**PRODUCTS[0], 'sku':'USD', 'currency':'USD', 'price':199, 'instock':25}
            eur={**PRODUCTS[0], 'sku':'EUR', 'currency':'EUR'}
            rows=[usd,eur]
            cart=store.update(session,'USD',2,rows)
            self.assertEqual(cart['currency'],'USD')
            self.assertEqual(cart['total'],398)
            with self.assertRaises(HttpError): store.update(session,'EUR',1,rows)
            with self.assertRaises(HttpError): store.set_shipping(session,{'cost':5,'currency':'EUR'},rows)
            cart=store.set_shipping(session,{'cost':5,'currency':'USD'},rows)
            self.assertEqual(cart['total'],403)
            self.assertTrue(retrieve([usd],'under 200'))
