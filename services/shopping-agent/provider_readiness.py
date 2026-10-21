"""Cached non-generating diagnostics, one daemon per replica, at most every 30s.
Bedrock reports TLS reachability only; activation tests establish model/IAM access.
Readiness never authorizes a request or overrides an inference error classification.
"""
import copy
import http.client
import os
import json
import ssl
import threading
import time
from urllib.parse import urlsplit
from llm_config import endpoints, service_headers
from deadlines import fetch, run


def check(config):
    if config["provider"] == "ollama":
        url = urlsplit(endpoints()[config["endpoint"]])
        cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
        conn = cls(url.hostname, url.port, timeout=1)
        try:
            conn.request("GET", "/api/tags")
            response = conn.getresponse()
            raw = response.read(65537)
            if response.status != 200 or len(raw) > 65536:
                return False
            models = json.loads(raw).get("models", [])
            return any(m.get("name") in (config["model"], config["model"] + ":latest") for m in models)
        finally:
            conn.close()
    host = f'bedrock-runtime.{config["region"]}.amazonaws.com'
    if config["region"].startswith("cn-"):
        host += ".cn"
    conn = http.client.HTTPSConnection(host, 443, timeout=1, context=ssl.create_default_context())
    try:
        conn.connect()
        return True
    finally:
        conn.close()


class ReadinessCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.config = {"provider": "none"}
        self.revision = -1
        self.cache = {}
        self.started = False

    def observe(self, config, revision):
        with self.lock:
            if revision < self.revision:
                return
            if config != self.config or revision != self.revision:
                self.config, self.revision, self.cache = copy.deepcopy(config), revision, {}
            if not self.started:
                self.started = True
                threading.Thread(target=self.run, daemon=True, name="llm-readiness").start()

    def snapshot(self):
        with self.lock:
            return {"revision": self.revision, "providers": copy.deepcopy(self.cache)}

    def run(self):
        while True:
            # Refresh from the authoritative record even after chat stops (disconnect).
            try:
                active = fetch(os.getenv("AI_GATEWAY_URL", "http://ai-gateway:3000") + "/internal/llm/config",
                               headers=service_headers(), deadline=time.monotonic()+1, timeout=1)
                self.observe(active["config"], active["revision"])
            except Exception:
                time.sleep(30)
                continue
            with self.lock:
                config, revision = copy.deepcopy(self.config), self.revision
            results = {}
            if config["provider"] != "none":
                targets = [config] + ([config["fallback"]] if config.get("automaticFailover") else [])
                for target in targets:
                    try:
                        ready = run(lambda target=target: check(target), 1.5)
                    except Exception:
                        ready = False
                    results[target["provider"]] = {"ready": ready, "checkedAt": time.time(),
                        "scope": "model-listed" if target["provider"] == "ollama" else "tls-reachable"}
            with self.lock:
                if revision == self.revision and config == self.config:
                    self.cache = results
            time.sleep(30)


readiness = ReadinessCache()
