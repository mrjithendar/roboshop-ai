"""All transports mocked: no inference, cloud calls or infrastructure."""
import threading
import time
import unittest
from unittest.mock import Mock, patch
import test_llm as existing
from test_llm import OLLAMA, BEDROCK, ALLOWLIST, req, agent_server, PRODUCTS
import os
import providers
from providers import ProviderError
from runtime import HttpError
from llm_config import validate_config
from routing import route, Circuit
from provider_readiness import ReadinessCache

POLICY = {**OLLAMA, "automaticFailover": True, "fallback": BEDROCK}
RESULT = {"answer": "answer", "provider": "bedrock", "model": BEDROCK["model"], "input_tokens": 2, "output_tokens": 1}


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"OLLAMA_ENDPOINTS_JSON": ALLOWLIST})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.breaker = Circuit()

    def call(self, generate, config=POLICY, **kwargs):
        return route(config, "system", "prompt", 1, generate=generate, breaker=self.breaker, **kwargs)

    def test_eligible_failures_one_attempt_each(self):
        for reason in ("timeout", "connection", "transient"):
            generate = Mock(side_effect=[ProviderError(reason), RESULT])
            self.assertEqual(self.call(generate)["fallbackReason"], reason)
            self.assertEqual([c.args[0]["provider"] for c in generate.call_args_list], ["ollama", "bedrock"])
        generate = Mock(side_effect=ProviderError("connection"))
        with self.assertRaises(ProviderError):
            route(POLICY, "s", "p", generate=generate, breaker=Circuit())
        self.assertEqual(generate.call_count, 2)

    def test_no_fallback_errors_or_direct_modes(self):
        for code in ("invalid-model", "invalid-input", "access-denied", "policy", "unavailable", "throttled"):
            generate = Mock(side_effect=ProviderError(code))
            with self.assertRaises(ProviderError):
                self.call(generate)
            self.assertEqual(generate.call_count, 1)
        for config in (OLLAMA, BEDROCK, {**POLICY, "automaticFailover": False}):
            generate = Mock(side_effect=ProviderError("timeout"))
            with self.assertRaises(ProviderError):
                self.call(generate, config)
            self.assertEqual(generate.call_count, 1)

    def test_success_is_never_switched(self):
        generate = Mock(return_value=RESULT)
        self.call(generate)
        self.assertEqual(generate.call_count, 1)

    def test_half_open_has_one_probe_and_recovery(self):
        clock = Mock(return_value=0)
        breaker = Circuit(clock)
        for _ in range(3):
            self.assertTrue(breaker.acquire("key"))
            breaker.finish("key", True)
        self.assertFalse(breaker.acquire("key"))
        clock.return_value = 31
        self.assertTrue(breaker.acquire("key"))
        self.assertFalse(breaker.acquire("key"))
        breaker.finish("key", True)
        self.assertFalse(breaker.acquire("key"))
        clock.return_value = 62
        self.assertTrue(breaker.acquire("key"))
        breaker.finish("key", False)
        self.assertTrue(breaker.acquire("key"))
        self.assertTrue(breaker.acquire("new-config"))

    def test_open_routes_directly_to_fallback(self):
        for _ in range(3):
            self.call(Mock(side_effect=[ProviderError("connection"), RESULT]))
        generate = Mock(return_value=RESULT)
        self.assertEqual(self.call(generate)["fallbackReason"], "circuit-open")
        self.assertEqual(generate.call_args.args[0], BEDROCK)

    def test_disconnect_between_attempts(self):
        guard = Mock(side_effect=[None, ProviderError("unavailable")])
        generate = Mock(side_effect=ProviderError("connection"))
        with self.assertRaises(ProviderError):
            self.call(generate, guard=guard)
        self.assertEqual(generate.call_count, 1)
        guard = Mock(side_effect=ProviderError("unavailable"))
        generate.reset_mock()
        with self.assertRaises(ProviderError):
            self.call(generate, guard=guard)
        generate.assert_not_called()

    def test_config_read_timeout_never_authorizes_fallback(self):
        generate = Mock()
        with self.assertRaises(ProviderError):
            self.call(generate, guard=Mock(side_effect=ProviderError("timeout")))
        generate.assert_not_called()

    def test_total_deadline_and_remaining_budget(self):
        generate = Mock()
        with self.assertRaises(ProviderError):
            self.call(generate, deadline=time.monotonic()-1)
        generate.assert_not_called()
        def slow(*args, **kwargs):
            time.sleep(.025)
            raise ProviderError("timeout")
        generate.side_effect = slow
        with self.assertRaises(ProviderError):
            self.call(generate, deadline=time.monotonic()+.01)
        self.assertEqual(generate.call_count, 1)
        self.assertLessEqual(generate.call_args.kwargs["budget"], .01)

    def test_policy_tests_both_and_does_not_use_breaker_or_guard(self):
        generate = Mock(return_value=RESULT)
        guard = Mock(side_effect=AssertionError())
        self.call(generate, purpose="test", guard=guard)
        self.assertEqual(generate.call_count, 2)
        guard.assert_not_called()
        generate = Mock(side_effect=[RESULT, ProviderError("access-denied")])
        with self.assertRaises(ProviderError):
            self.call(generate, purpose="test")

    def test_concurrent_half_open_recovery_admits_single_primary(self):
        breaker = Circuit(clock=lambda: 100)
        breaker.key, breaker.failures, breaker.until = "k", 3, 0
        barrier = threading.Barrier(8)
        results = []
        def worker():
            barrier.wait()
            results.append(breaker.acquire("k"))
        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count(True), 1)

    def test_revision_change_resets_open_breaker(self):
        for _ in range(3):
            self.call(Mock(side_effect=[ProviderError("connection"), RESULT]))
        generate = Mock(return_value=RESULT)
        route(POLICY, "s", "p", 2, generate=generate, breaker=self.breaker)
        self.assertEqual(generate.call_args.args[0]["provider"], "ollama")

    def test_server_checks_authority_before_fallback(self):
        with patch.dict(os.environ, {"LLM_SERVICE_TOKEN": "a"*64}), patch.object(agent_server, "fetch", side_effect=[{"products":PRODUCTS}, {"config":POLICY,"revision":1}, {"config":{"provider":"none"},"revision":2}]), patch.object(agent_server.readiness, "observe"), patch("ollama_provider.generate", side_effect=ConnectionRefusedError()) as primary, patch("bedrock_provider.generate") as fallback:
            result = agent_server.handle(req("/internal/chat", "POST", {"config":POLICY,"revision":1,"message":"security"}, token="Bearer " + "a"*64))
        self.assertEqual(result["mode"], "provider-unavailable")
        primary.assert_called_once()
        fallback.assert_not_called()

    def test_slow_provider_is_bounded_and_not_retried(self):
        done = threading.Event()
        def slow(*args, **kwargs):
            done.wait(.2)
            return RESULT
        try:
            with patch("ollama_provider.generate", side_effect=slow) as primary, patch("bedrock_provider.generate") as fallback:
                start = time.monotonic()
                with self.assertRaises(ProviderError):
                    route(POLICY,"s","p",deadline=start+.01,breaker=Circuit())
                self.assertLess(time.monotonic()-start,.1)
                primary.assert_called_once()
                fallback.assert_not_called()  # No remaining budget.
        finally:
            done.set()
            providers.pool.submit(lambda: None).result(timeout=1)

    def test_validation_opt_in_and_credentials(self):
        self.assertEqual(validate_config(POLICY), POLICY)
        for config in (POLICY | {"automaticFailover": "yes"}, POLICY | {"fallback": OLLAMA}, POLICY | {"aws_access_key_id": "no"}, POLICY | {"fallback": BEDROCK | {"secret": "no"}}):
            with self.assertRaises(HttpError):
                validate_config(config)

    def test_actual_transport_classification(self):
        from ollama_provider import ResponseError
        for status, expected in [(401,"access-denied"),(403,"access-denied"),(400,"invalid-input"),(429,"transient"),(503,"transient"),(302,"invalid-input")]:
            with patch("ollama_provider.generate", side_effect=ResponseError(status)):
                with self.assertRaises(ProviderError) as caught:
                    providers.invoke(OLLAMA, "s", "p")
                self.assertEqual(caught.exception.code, expected)
        with patch("ollama_provider.generate", side_effect=ConnectionRefusedError()):
            with self.assertRaises(ProviderError) as caught:
                providers.invoke(OLLAMA,"s","p")
            self.assertEqual(caught.exception.code,"connection")

    def test_refusal_and_malformed_content_never_fall_back(self):
        for response, code in [(RESULT | {"refused": True}, "policy"), (RESULT | {"answer": ""}, "unavailable")]:
            with patch("ollama_provider.generate", return_value=response), patch("bedrock_provider.generate") as fallback:
                with self.assertRaises(ProviderError) as caught:
                    route(POLICY,"s","p",breaker=Circuit())
                self.assertEqual(caught.exception.code, code)
                fallback.assert_not_called()

    def test_private_diagnostic_requires_authorization(self):
        with patch.dict(os.environ, {"LLM_SERVICE_TOKEN": "a"*64}):
            with self.assertRaises(HttpError) as caught:
                agent_server.handle(req("/internal/llm/readiness", "GET", token=""))
            self.assertEqual(caught.exception.status,403)

    def test_background_checks_use_no_generation_endpoint(self):
        from provider_readiness import check
        import json
        connection = Mock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = json.dumps({"models":[{"name":OLLAMA["model"]}]}).encode()
        with patch("provider_readiness.http.client.HTTPConnection", return_value=connection):
            self.assertTrue(check(OLLAMA))
        connection.request.assert_called_once_with("GET", "/api/tags")
        connection = Mock()
        with patch("provider_readiness.http.client.HTTPSConnection", return_value=connection):
            self.assertTrue(check(BEDROCK))
        connection.connect.assert_called_once()
        connection.request.assert_not_called()

    def test_invalid_input_never_generates(self):
        with patch("ollama_provider.generate") as primary, patch("bedrock_provider.generate") as fallback:
            with self.assertRaises(HttpError) as caught:
                route(POLICY, "s", "x"*12001, breaker=Circuit())
            self.assertEqual(caught.exception.status,400)
            primary.assert_not_called()
            fallback.assert_not_called()

    def test_readiness_is_cached_no_generation(self):
        cache = ReadinessCache()
        with patch("provider_readiness.threading.Thread") as thread:
            cache.observe(POLICY, 1)
            cache.observe(POLICY, 1)
            self.assertEqual(thread.call_count, 1)
            self.assertEqual(cache.snapshot()["providers"], {})
            cache.observe({"provider":"none"}, 2)
            cache.observe(POLICY, 1)
            self.assertEqual(cache.snapshot()["revision"], 2)

    def test_retrieval_deadline(self):
        from deadlines import fetch
        with patch("deadlines.request", side_effect=lambda *a, **kw: time.sleep(.05)):
            start = time.monotonic()
            with self.assertRaises(ProviderError):
                fetch("mock", deadline=start+.01)
            self.assertLess(time.monotonic()-start, .04)

    def test_attempt_trace_metadata_same_parent_no_content(self):
        traces = []
        from runtime import trace_span
        with patch("runtime.telemetry", side_effect=lambda *args: traces.append(args)), patch("ollama_provider.generate", side_effect=ConnectionRefusedError()), patch("bedrock_provider.generate", return_value=RESULT):
            with trace_span("request"):
                route(POLICY,"secret-system","private-prompt",breaker=Circuit())
        generations = [t[1] for t in traces if t[1]["attributes"].get("langfuse.observation.type") == "generation"]
        self.assertEqual(len(generations), 2)
        self.assertEqual(generations[0]["traceId"], generations[1]["traceId"])
        self.assertEqual(generations[1]["attributes"]["roboshop.llm.fallback_reason"], "connection")
        self.assertEqual(generations[1]["attributes"]["gen_ai.usage.input_tokens"],2)
        self.assertNotIn("private-prompt",str(traces))


class PolicyConfigurationTests(unittest.TestCase):
    setUp = existing.ConfigurationTests.setUp
    save = existing.ConfigurationTests.save

    def test_activation_requires_successful_test_and_audits_policy(self):
        self.remote.return_value = {"ok": False}
        with self.assertRaises(HttpError):
            self.save(POLICY)
        self.assertEqual(self.config.current()["revision"],0)
        self.remote.return_value = {"ok": True}
        result = self.save(POLICY)
        self.assertIsNotNone(result["verifiedAt"])
        self.assertTrue(result["audit"][-1]["summary"]["automaticFailover"])
        self.assertEqual(result["audit"][-1]["summary"]["fallback"], BEDROCK)

    def test_disconnect_during_activation_test_cannot_be_overwritten(self):
        self.save(OLLAMA)
        def disconnect(*args, **kwargs):
            self.config.routes(req("/api/admin/llm/disconnect", "POST", {"revision":1}))
            return {"ok":True}
        self.remote.side_effect = disconnect
        with self.assertRaises(HttpError) as caught:
            self.save(POLICY,1)
        self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.config.current()["config"],{"provider":"none"})
