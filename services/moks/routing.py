"""Per-replica bounded routing. No retries, streaming, or persisted breaker state."""
import json
import threading
import time
from runtime import trace_span, log_event
from providers import invoke, ProviderError

ELIGIBLE = {"connection", "timeout", "transient"}


class Circuit:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.key = None
        self.failures = 0
        self.until = 0
        self.probing = False

    def acquire(self, key):
        with self.lock:
            if key != self.key:
                self.key, self.failures, self.until, self.probing = key, 0, 0, False
            if self.failures < 3:
                return True
            if self.clock() < self.until or self.probing:
                return False
            self.probing = True
            return True

    def finish(self, key, failed):
        with self.lock:
            if key != self.key:
                return
            self.probing = False
            if failed:
                self.failures += 1
                if self.failures >= 3:
                    self.until = self.clock() + 30
            else:
                self.failures, self.until = 0, 0


circuit = Circuit()


def route(config, system, prompt, revision=0, purpose="chat", *, deadline=None,
          guard=lambda: None, generate=invoke, breaker=circuit):
    deadline = deadline if deadline is not None else time.monotonic() + 16
    primary = {k: v for k, v in config.items() if k not in ("fallback", "automaticFailover")}
    enabled = config.get("automaticFailover") is True
    key = (revision, json.dumps(config, sort_keys=True))
    attrs = {"roboshop.llm.revision": revision, "roboshop.llm.failover_enabled": enabled}
    with trace_span("llm routing", attributes=attrs, service="moks"):
        def attempt(target, reason=None):
            if deadline - time.monotonic() <= 0:
                raise ProviderError("timeout")
            if purpose != "test":
                try:
                    guard()  # Configuration authorization, not a provider attempt.
                except ProviderError:
                    # Control-plane outages cannot authorize paid fallback.
                    raise ProviderError("unavailable") from None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("timeout")
            started = time.monotonic()
            log_event("llm_attempt_started", provider=target["provider"], model=target.get("model"), reason=reason or "primary", revision=revision)
            try:
                result = generate(target, system, prompt, revision, purpose,
                                  budget=min(6 if enabled else 12, remaining), fallback_reason=reason)
            except ProviderError as error:
                log_event("llm_attempt_failed", "WARN", provider=target["provider"], errorCode=error.code, durationMs=round((time.monotonic()-started)*1000))
                raise
            log_event("llm_attempt_completed", provider=target["provider"], model=target.get("model"), durationMs=round((time.monotonic()-started)*1000))
            return result

        if purpose == "test":
            result = attempt(primary)
            if enabled:
                attempt(config["fallback"])
            return result
        reason = "circuit-open"
        if not enabled or breaker.acquire(key):
            try:
                result = attempt(primary)
            except ProviderError as error:
                if enabled:
                    breaker.finish(key, error.code in ELIGIBLE)
                if not enabled or error.code not in ELIGIBLE:
                    raise
                reason = error.code
            except Exception:
                if enabled:
                    breaker.finish(key, False)
                raise
            else:
                if enabled:
                    breaker.finish(key, False)
                return result
        log_event("llm_failover_selected", "WARN", provider="bedrock", reason=reason, revision=revision)
        attrs["roboshop.llm.fallback_reason"] = reason
        # Exactly one fallback. Errors propagate; never retry either provider.
        result = attempt(config["fallback"], reason)
        return {**result, "fallbackReason": reason}
