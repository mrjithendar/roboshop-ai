"""Bounded core-dependency probes, deliberately independent of SRE/AI health."""
from concurrent.futures import ThreadPoolExecutor, wait
import threading
import pymongo
from runtime import request

POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix='readiness')
SLOTS = threading.BoundedSemaphore(8)


def probe(checks, budget=1.5):
    futures, states = {}, {}
    def run(check):
        try:
            check()
            return 'ready'
        except Exception:
            return 'unavailable'
        finally:
            SLOTS.release()
    for name, check in checks.items():
        if SLOTS.acquire(blocking=False):
            futures[name] = POOL.submit(run, check)
        else:
            states[name] = 'unavailable'
    wait(futures.values(), timeout=budget)
    states.update({name: future.result() if future.done() else 'unavailable' for name, future in futures.items()})
    ready = all(value == 'ready' for value in states.values())
    return {'status': 'ready' if ready else 'unavailable', 'dependencies': states}, 200 if ready else 503, []


def gateway_readiness(gateway):
    def mongo():
        with pymongo.timeout(1):
            gateway.db.command('ping')
    checks = {
        'mongodb': mongo,
        'catalogue': lambda: request(gateway.urls['catalogue'] + '/api/catalogue/ready', timeout=1),
        'users': lambda: request(gateway.auth.url + '/api/users/ready', timeout=1),
        'ledger': lambda: gateway.store.check_writer(),
    }
    if gateway.store.cart_repository:
        checks['cart'] = lambda: request(gateway.store.cart_repository.url + '/ready', timeout=1)
    return probe(checks)
