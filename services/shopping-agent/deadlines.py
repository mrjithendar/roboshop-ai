"""Bounded blocking retrieval/config reads; timed-out workers retain their slot."""
import contextvars
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from runtime import request
from providers import ProviderError

pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent-io")
slots = threading.BoundedSemaphore(4)


def run(call, budget):
    if budget <= 0:
        raise ProviderError("timeout")
    if not slots.acquire(False):
        raise ProviderError("throttled")
    try:
        future = pool.submit(contextvars.copy_context().run, call)
    except Exception:
        slots.release()
        raise
    future.add_done_callback(lambda _: slots.release())
    try:
        return future.result(timeout=budget)
    except TimeoutError:
        raise ProviderError("timeout") from None


def fetch(url, *, deadline, timeout=2, headers=None):
    budget = min(timeout, deadline - time.monotonic())
    return run(lambda: request(url, headers=headers, timeout=budget), budget)
