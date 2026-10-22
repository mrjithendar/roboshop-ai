import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import mongomock
from botocore.exceptions import ClientError, ReadTimeoutError

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT / "services/ai-gateway/lib"),
    str(ROOT / "services/ai-gateway"),
    str(ROOT / "services/moks"),
]
from llm_config import validate_config, endpoints, unconfigured, UNCONFIGURED
from llm import LLMConfiguration
from agent import answer
from providers import invoke, ProviderError
import providers
import bedrock_provider
import ollama_provider
from runtime import HttpError, Request, application
from store import Store


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gateway_module = load("llm_gateway", "services/ai-gateway/server.py")
agent_server = load("llm_agent_server", "services/moks/server.py")
BEDROCK = {
    "provider": "bedrock",
    "region": "us-east-1",
    "model": "amazon.nova-micro-v1:0",
}
OLLAMA = {"provider": "ollama", "endpoint": "private-ec2", "model": "qwen3:4b"}
ALLOWLIST = json.dumps({"private-ec2": "http://10.1.2.3:11434"})
PRODUCTS = json.loads(
    (ROOT / "tests/fixtures/catalogue/fictional-products.json").read_text()
)


def req(
    path="/api/admin/llm",
    method="PUT",
    data=None,
    role="superadmin",
    origin="http://localhost:3000",
    token=None,
):
    raw = json.dumps(data or {}).encode()
    result = Request(
        {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "CONTENT_TYPE": "application/json",
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
            "HTTP_ORIGIN": origin,
            "HTTP_AUTHORIZATION": token or "",
        }
    )
    result.user = {"id": "operator", "role": role} if role else None
    return result


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {"OLLAMA_ENDPOINTS_JSON": ALLOWLIST, "LLM_SERVICE_TOKEN": "a" * 64},
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.db = mongomock.MongoClient().test
        self.config = LLMConfiguration(self.db, "http://agent:4103")
        self.remote = patch("llm.request", return_value={"ok": True}).start()
        self.addCleanup(patch.stopall)

    def save(self, config, revision=0):
        return self.config.routes(req(data={"revision": revision, "config": config}))

    def test_default_and_legacy_environment_never_activate(self):
        with patch.dict(
            os.environ, {"OPENAI_API_KEY": "legacy-secret", "OPENAI_MODEL": "legacy"}
        ):
            self.assertEqual(self.config.current()["config"], {"provider": "none"})
            no_call = Mock(side_effect=AssertionError("provider call"))
            result = answer(PRODUCTS, "security", generate=no_call)
            self.assertEqual(result["answer"], UNCONFIGURED)
            self.assertEqual(result["products"], [])
            self.assertEqual(result["mode"], "not-configured")
            no_call.assert_not_called()
            self.remote.assert_not_called()

    def test_all_admin_paths_require_superadmin(self):
        for role in ("customer", "admin", None):
            for path, method in [
                ("/api/admin/llm", "GET"),
                ("/api/admin/llm", "PUT"),
                ("/api/admin/llm/test", "POST"),
                ("/api/admin/llm/disconnect", "POST"),
            ]:
                with self.subTest(role=role, path=path):
                    with self.assertRaises(HttpError) as error:
                        self.config.routes(
                            req(path, method, {"revision": 0, "config": BEDROCK}, role)
                        )
                    self.assertIn(error.exception.status, (401, 403))
        self.remote.assert_not_called()

    def test_test_activate_switch_disconnect_and_audit(self):
        result = self.config.routes(
            req("/api/admin/llm/test", "POST", {"revision": 0, "config": BEDROCK})
        )
        self.assertFalse(result["activated"])
        self.assertEqual(self.config.current()["revision"], 0)
        saved = self.save(BEDROCK)
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(self.remote.call_count, 1)  # only explicit tests contact the provider
        saved = self.save(OLLAMA, 1)
        self.assertEqual(saved["config"], OLLAMA)
        disconnected = self.config.routes(
            req("/api/admin/llm/disconnect", "POST", {"revision": 2})
        )
        self.assertEqual(disconnected["config"], {"provider": "none"})
        self.assertEqual(self.remote.call_count, 1)
        self.assertEqual([e["revision"] for e in disconnected["audit"]], [1, 2, 3])
        self.assertTrue(
            all(
                e["actor"] == "operator" and "timestamp" in e
                for e in disconnected["audit"]
            )
        )
        self.assertNotIn("10.1.2.3", json.dumps(disconnected, default=str))
        self.assertEqual(
            self.remote.call_args.args[2]["Authorization"], "Bearer " + "a" * 64
        )

    def test_offline_save_disconnect_and_stale_revision(self):
        self.remote.side_effect = HttpError(503, "Provider unavailable")
        self.save(BEDROCK)
        saved = self.save(OLLAMA, 1)
        self.assertEqual(saved["config"], OLLAMA)
        self.assertIsNone(saved["verifiedAt"])
        with self.assertRaises(HttpError) as error:
            self.save(BEDROCK, 0)
        self.assertEqual(error.exception.status, 409)
        # Even a broken optional Ollama allowlist cannot prevent disconnection.
        with patch.dict(os.environ, {"OLLAMA_ENDPOINTS_JSON": "invalid"}):
            disconnected = self.config.routes(req("/api/admin/llm/disconnect", "POST", {"revision": 2}))
        self.assertEqual(disconnected["config"], {"provider": "none"})
        self.remote.assert_not_called()

    def test_concurrent_save_rejected_atomically(self):
        self.save(BEDROCK)
        update = self.config.collection.find_one_and_update
        def other_update(*args, **kwargs):
            self.db.llm_configuration.update_one({"_id": "active"}, {"$inc": {"revision": 1}})
            return update(*args, **kwargs)
        with patch.object(self.config.collection, "find_one_and_update", side_effect=other_update):
            with self.assertRaises(HttpError) as error:
                self.save(OLLAMA, 1)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.config.current()["config"], BEDROCK)
        self.assertEqual(len(self.config.current()["audit"]), 1)

    def test_first_save_race_cannot_overwrite(self):
        update = self.config.collection.find_one_and_update
        def other_update(*args, **kwargs):
            self.db.llm_configuration.insert_one({"_id": "active", "revision": 1, "config": BEDROCK})
            return update(*args, **kwargs)
        with patch.object(self.config.collection, "find_one_and_update", side_effect=other_update):
            with self.assertRaises(HttpError) as error:
                self.save(OLLAMA)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.config.current()["config"], BEDROCK)

    def test_proposed_test_failure_preserves_existing_configuration(self):
        self.save(BEDROCK)
        before = self.config.current()
        self.remote.return_value = {"ok": False, "errorCode": "access-denied"}
        with self.assertRaises(HttpError) as caught:
            self.config.routes(
                req("/api/admin/llm/test", "POST", {"revision": 1, "config": OLLAMA})
            )
        self.assertEqual(caught.exception.status, 503)
        self.assertIn("access denied", str(caught.exception))
        self.assertEqual(self.config.current(), before)

    def test_unknown_fields_are_rejected(self):
        for extra in ("url", "aws_access_key_id", "tested"):
            with self.assertRaises(HttpError):
                self.save(BEDROCK | {extra: "secret"})
        self.remote.assert_not_called()


@unittest.skipUnless(
    os.getenv("MONGODB_URL"), "Requires isolated MongoDB test connection"
)
class RealMongoConfigurationTests(ConfigurationTests):
    def setUp(self):
        super().setUp()
        import uuid
        from pymongo import MongoClient

        client = MongoClient(os.environ["MONGODB_URL"], tz_aware=True)
        self.db = client["llm_test_" + uuid.uuid4().hex]
        self.addCleanup(client.close)
        self.addCleanup(lambda: client.drop_database(self.db.name))
        self.config = LLMConfiguration(self.db, "http://agent:4103")


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {"OLLAMA_ENDPOINTS_JSON": ALLOWLIST, "OTEL_SDK_DISABLED": "true"},
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_bedrock_mapping_and_workload_credentials(self):
        client = Mock()
        client.converse.return_value = {
            "output": {"message": {"content": [{"text": "answer"}]}},
            "usage": {"inputTokens": 12, "outputTokens": 3},
        }
        with patch("boto3.client", return_value=client) as factory:
            result = bedrock_provider.generate(BEDROCK, "system", "prompt", 600)
        args = client.converse.call_args.kwargs
        self.assertEqual(args["modelId"], BEDROCK["model"])
        self.assertEqual(
            args["messages"], [{"role": "user", "content": [{"text": "prompt"}]}]
        )
        self.assertEqual(args["inferenceConfig"]["maxTokens"], 600)
        self.assertEqual(result["input_tokens"], 12)
        self.assertEqual(result["output_tokens"], 3)
        self.assertNotIn("aws_access_key_id", factory.call_args.kwargs)
        self.assertEqual(
            factory.call_args.kwargs["config"].retries["total_max_attempts"], 1
        )
        client.close.assert_called_once()

    def test_ollama_mapping_no_proxy_and_no_redirects(self):
        client = Mock()
        response = client.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps(
            {
                "done": True,
                "message": {"content": "answer"},
                "prompt_eval_count": 10,
                "eval_count": 2,
            }
        ).encode()
        with patch(
            "ollama_provider.http.client.HTTPConnection", return_value=client
        ) as factory:
            result = ollama_provider.generate(OLLAMA, "system", "prompt", 600)
            factory.assert_called_with("10.1.2.3", 11434, timeout=8)
            payload = json.loads(client.request.call_args.kwargs["body"])
            self.assertEqual(client.request.call_args.args[:2], ("POST", "/api/chat"))
            self.assertFalse(payload["stream"])
            self.assertFalse(payload["think"])
            self.assertEqual(payload["options"], {"num_ctx": 4096, "num_predict": 600})
            self.assertEqual(result["output_tokens"], 2)
            response.status = 302
            with self.assertRaises(ValueError):
                ollama_provider.generate(OLLAMA, "system", "prompt", 32)
            self.assertEqual(factory.call_count, 2)  # no redirect follow-up

    def test_allowlist_rejects_ssrf_schemes_ports_hosts_and_metadata(self):
        self.assertEqual(validate_config(OLLAMA), OLLAMA)
        with self.assertRaises(HttpError):
            validate_config(OLLAMA | {"endpoint": "http://evil"})
        for url in [
            "file:///etc/passwd",
            "http://169.254.169.254:80",
            "http://127.0.0.1:80",
            "http://0.0.0.0:80",
            "http://example.com:80",
            "http://10.1.2.3",
            "http://user:secret@10.1.2.3:11434",
            "http://10.1.2.3:11434/api/chat",
            "http://10.1.2.3:11434?x=1",
            "ftp://10.1.2.3:11434",
            "http://10.1.2.3:70000",
        ]:
            with self.subTest(url=url), patch.dict(
                os.environ, {"OLLAMA_ENDPOINTS_JSON": json.dumps({"private-ec2": url})}
            ):
                with self.assertRaises(HttpError):
                    endpoints()

    def test_direct_bedrock_errors_sanitized_without_fallback(self):
        cases = [
            ("AccessDeniedException", "access-denied"),
            ("ValidationException", "invalid-model"),
            ("ThrottlingException", "throttled"),
            ("InternalServerException", "unavailable"),
        ]
        for code, expected in cases:
            error = ClientError(
                {"Error": {"Code": code, "Message": "secret prompt endpoint"}},
                "Converse",
            )
            with patch("bedrock_provider.generate", side_effect=error), patch(
                "ollama_provider.generate"
            ) as other:
                with self.assertRaises(ProviderError) as caught:
                    invoke(BEDROCK, "system", "private prompt")
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn("secret", str(caught.exception))
                other.assert_not_called()
        with patch(
            "bedrock_provider.generate",
            side_effect=ReadTimeoutError(endpoint_url="private"),
        ):
            with self.assertRaises(ProviderError) as caught:
                invoke(BEDROCK, "system", "prompt")
            self.assertEqual(caught.exception.code, "timeout")

    def test_direct_ollama_failure_does_not_call_bedrock(self):
        with patch(
            "ollama_provider.generate", side_effect=ValueError("private-url")
        ), patch("bedrock_provider.generate") as other:
            with self.assertRaises(ProviderError) as caught:
                invoke(OLLAMA, "system", "prompt", purpose="test")
            self.assertNotIn("private-url", str(caught.exception))
            other.assert_not_called()

    def test_deadline_and_bounded_concurrency(self):
        event = threading.Event()

        def blocking(*args):
            event.wait(1)
            return {"answer": "ok", "input_tokens": 1, "output_tokens": 1}

        try:
            with patch("providers.DEADLINE", 0.01), patch(
                "bedrock_provider.generate", side_effect=blocking
            ):
                for _ in range(2):
                    with self.assertRaises(ProviderError) as caught:
                        invoke(BEDROCK, "s", "p")
                    self.assertEqual(caught.exception.code, "timeout")
                with self.assertRaises(ProviderError) as caught:
                    invoke(BEDROCK, "s", "p")
                self.assertEqual(caught.exception.code, "throttled")
        finally:
            event.set()
            # Await worker completion without reaching any real provider.
            providers.pool.submit(lambda: None).result(timeout=2)
            providers.pool.submit(lambda: None).result(timeout=2)

    def test_grounded_evidence_and_explicit_failure(self):
        def fake(config, system, prompt, revision, purpose):
            self.assertEqual(json.loads(prompt)["catalogueEvidence"][0]["sku"], "RED")
            self.assertEqual(revision, 4)
            return {
                "answer": "Grounded answer",
                "provider": "bedrock",
                "model": config["model"],
                "input_tokens": 10,
                "output_tokens": 4,
            }

        result = answer(PRODUCTS, "security under 1000", BEDROCK, 4, fake)
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["products"][0]["sku"], "RED")
        result = answer(
            PRODUCTS,
            "security",
            BEDROCK,
            generate=Mock(side_effect=ProviderError("unavailable")),
        )
        self.assertEqual(result["status"], "provider-unavailable")
        self.assertEqual(result["products"], [])

    def test_telemetry_has_metadata_but_not_prompt(self):
        captured = []
        result = {
            "answer": "private answer",
            "provider": "bedrock",
            "model": BEDROCK["model"],
            "input_tokens": 3,
            "output_tokens": 2,
        }
        with patch("bedrock_provider.generate", return_value=result), patch(
            "runtime.telemetry", side_effect=lambda *args: captured.append(args)
        ):
            invoke(
                BEDROCK, "private instructions", "personal customer prompt", 12, "test"
            )
        attrs = captured[0][1]["attributes"]
        self.assertEqual(attrs["roboshop.llm.revision"], 12)
        self.assertEqual(attrs["roboshop.llm.purpose"], "test")
        self.assertEqual(attrs["roboshop.llm.outcome"], "success")
        self.assertNotIn("personal", json.dumps(attrs))
        self.assertNotIn("private answer", json.dumps(attrs))


class GatewayBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = mongomock.MongoClient().test
        with patch.dict(os.environ, {"USER_SERVICE_TOKEN": "u" * 64}):
            self.gateway = gateway_module.Gateway(self.db, Store(self.directory.name))
        self.user = {"id": "root", "role": "superadmin"}
        self.gateway.auth.current = Mock(side_effect=lambda _: self.user)
        self.gateway.limit = Mock()
        self.env = patch.dict(
            os.environ,
            {"LLM_SERVICE_TOKEN": "a" * 64, "OLLAMA_ENDPOINTS_JSON": ALLOWLIST},
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_chat_requires_private_service_authentication(self):
        with patch.object(gateway_module, "request") as remote:
            for token in (None, "Bearer invalid"):
                with self.assertRaises(HttpError):
                    self.gateway.handle(req("/api/chat", "POST", {"message": "security"}, token=token))
            remote.assert_not_called()

    def test_default_chat_no_dependencies_and_no_customer_override(self):
        with patch.object(gateway_module, "request") as remote:
            result = self.gateway.handle(
                req("/api/chat", "POST", {"message": "security"}, token="Bearer " + "a" * 64)
            )
            self.assertEqual(result["answer"], UNCONFIGURED)
            remote.assert_not_called()
            for extra in ("provider", "config", "model", "endpoint", "revision"):
                with self.assertRaises(HttpError):
                    self.gateway.handle(
                        req("/api/chat", "POST", {"message": "security", extra: "bad"}, token="Bearer " + "a" * 64)
                    )
            remote.assert_not_called()

    def test_origin_required_for_every_mutation(self):
        for path, method in [
            ("/api/admin/llm", "PUT"),
            ("/api/admin/llm/test", "POST"),
            ("/api/admin/llm/disconnect", "POST"),
        ]:
            for origin in ("", "https://evil.test"):
                with self.assertRaises(HttpError) as caught:
                    self.gateway.handle(
                        req(
                            path,
                            method,
                            {"revision": 0, "config": BEDROCK},
                            origin=origin,
                        )
                    )
                self.assertEqual(caught.exception.status, 403)

    def test_configuration_private_and_changes_apply_next_request(self):
        self.db.llm_configuration.insert_one(
            {"_id": "active", "revision": 1, "config": BEDROCK}
        )
        self.gateway.catalogue = Mock(return_value=PRODUCTS)
        with patch.object(
            gateway_module, "request", return_value={"products": [], "mode": "ai"}
        ) as remote:
            self.gateway.handle(req("/api/chat", "POST", {"message": "security"}, token="Bearer " + "a" * 64))
            self.assertEqual(remote.call_args.args[1]["config"], BEDROCK)
            self.assertIn("/internal/chat", remote.call_args.args[0])
            with patch("llm.request", return_value={"ok": True}):
                self.gateway.handle(
                    req("/api/admin/llm/disconnect", "POST", {"revision": 1})
                )
            self.assertEqual(
                self.gateway.handle(req("/api/chat", "POST", {"message": "security"}, token="Bearer " + "a" * 64))[
                    "mode"
                ],
                "not-configured",
            )
            self.assertEqual(remote.call_count, 1)
        public = self.gateway.handle(req("/api/settings", "GET"))
        self.assertNotIn("config", public)
        self.assertNotIn("provider", public)
        self.assertNotIn("endpoint", public)

    def test_chat_capacity_keeps_configuration_reads_available(self):
        self.db.llm_configuration.insert_one({"_id":"active","revision":1,"config":BEDROCK})
        self.gateway.catalogue = Mock(return_value=PRODUCTS)
        self.gateway.chat_slots.acquire()
        self.gateway.chat_slots.acquire()
        try:
            with patch.object(gateway_module, "request") as remote:
                result = self.gateway.handle(req("/api/chat", "POST", {"message":"help"}, token="Bearer " + "a"*64))
                self.assertEqual(result[1],503)
                remote.assert_not_called()
            active = self.gateway.handle(req("/internal/llm/config", "GET", token="Bearer " + "a"*64))
            self.assertEqual(active["config"], BEDROCK)
        finally:
            self.gateway.chat_slots.release()
            self.gateway.chat_slots.release()

    def test_active_configuration_endpoint_requires_service_authorization(self):
        with self.assertRaises(HttpError) as caught:
            self.gateway.handle(req("/internal/llm/config", "GET"))
        self.assertEqual(caught.exception.status,403)
        self.assertEqual(self.gateway.handle(req("/internal/llm/config", "GET", token="Bearer " + "a"*64)),
                         {"config":{"provider":"none"},"revision":0})

    def test_agent_routes_require_service_authentication(self):
        for token in ("", "Bearer incorrect"):
            with self.assertRaises(HttpError):
                agent_server.handle(
                    req(
                        "/internal/chat",
                        "POST",
                        {"revision": 0, "config": {"provider": "none"}},
                        token=token,
                    )
                )
        with patch.object(agent_server, "request") as network:
            result = agent_server.handle(
                req(
                    "/internal/chat",
                    "POST",
                    {"revision": 0, "config": {"provider": "none"}},
                    token="Bearer " + "a" * 64,
                )
            )
            self.assertEqual(result, unconfigured())
            network.assert_not_called()
        with self.assertRaises(HttpError):
            agent_server.handle(req("/api/chat", "POST", {"message": "hi"}))

    def test_errors_include_request_id_without_internal_exception(self):
        app = application(
            "test", lambda _: (_ for _ in ()).throw(ProviderError("unavailable"))
        )
        captured = {}
        with patch("runtime.telemetry"):
            body = b"".join(
                app(
                    req().environ,
                    lambda status, headers: captured.update(status=status),
                )
            )
        result = json.loads(body)
        self.assertEqual(len(result["requestId"]), 32)
        self.assertTrue(captured["status"].startswith("503"))


if __name__ == "__main__":
    unittest.main()
