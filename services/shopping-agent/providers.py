"""Bounded execution and normalized, sanitized outcomes for both adapters."""

import contextvars
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import bedrock_provider
import ollama_provider
from llm_config import validate_config
from runtime import HttpError, trace_span

pool = ThreadPoolExecutor(max_workers=2)
slots = threading.BoundedSemaphore(2)
DEADLINE = 12


class ProviderError(HttpError):
    def __init__(self, code):
        self.code = code
        super().__init__(
            503,
            {
                "timeout": "LLM provider timed out.",
                "access-denied": "LLM provider access denied. Check workload permissions.",
                "invalid-model": "LLM model is unavailable or incompatible.",
                "throttled": "LLM provider is busy. Please try again.",
                "unavailable": "LLM provider unavailable. Please try again.",
            }[code],
        )


def invoke(config, system, prompt, revision=0, purpose="chat"):
    config = validate_config(config)
    if config["provider"] == "none":
        raise HttpError(409, "No LLM is configured.")
    if len(prompt) > 12000 or len(system) > 2000:
        raise HttpError(400, "LLM input exceeds the context budget.")
    attrs = {
        "gen_ai.system": config["provider"],
        "gen_ai.request.model": config["model"],
        "robotshop.llm.revision": revision,
        "robotshop.llm.purpose": purpose,
        "langfuse.observation.type": "generation",
    }
    with trace_span("llm " + purpose, attributes=attrs, service="shopping-agent"):
        start = time.monotonic()
        try:
            if not slots.acquire(blocking=False):
                raise ProviderError("throttled")
            adapter = (
                bedrock_provider if config["provider"] == "bedrock" else ollama_provider
            )
            try:
                context = contextvars.copy_context()
                future = pool.submit(
                    context.run,
                    adapter.generate,
                    config,
                    system,
                    prompt,
                    32 if purpose == "test" else 600,
                )
            except Exception:
                slots.release()
                raise
            future.add_done_callback(lambda _: slots.release())
            result = future.result(timeout=DEADLINE)
            if (
                not isinstance(result.get("answer"), str)
                or not result["answer"].strip()
                or len(result["answer"]) > 12000
            ):
                raise ValueError("invalid response")
            for key in ("input_tokens", "output_tokens"):
                if type(result.get(key)) is not int or result[key] < 0:
                    result[key] = None
                if result[key] is not None:
                    attrs["gen_ai.usage." + key] = result[key]
            attrs["robotshop.llm.outcome"] = "success"
            return result
        except ProviderError as error:
            attrs["robotshop.llm.outcome"] = error.code
            raise
        except Exception as error:
            code = (
                (getattr(error, "response", None) or {})
                .get("Error", {})
                .get("Code", "")
            )
            reason = {
                "AccessDeniedException": "access-denied",
                "UnrecognizedClientException": "access-denied",
                "ValidationException": "invalid-model",
                "ResourceNotFoundException": "invalid-model",
                "ThrottlingException": "throttled",
                "ServiceQuotaExceededException": "throttled",
            }.get(code, "unavailable")
            if isinstance(error, TimeoutError) or type(error).__name__ in (
                "ReadTimeoutError",
                "ConnectTimeoutError",
                "TimeoutError",
            ):
                reason = "timeout"
            attrs["robotshop.llm.outcome"] = reason
            raise ProviderError(reason) from None
        finally:
            attrs["robotshop.llm.latency_ms"] = round((time.monotonic() - start) * 1000)
