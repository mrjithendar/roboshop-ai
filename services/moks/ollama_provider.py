"""Direct pinned-address HTTP; no proxies, redirects, DNS or arbitrary URL paths."""

import http.client
import json
import ssl
import socket
import threading
from urllib.parse import urlsplit
from llm_config import endpoints


class ResponseError(ValueError):
    def __init__(self, status):
        self.status = status
        super().__init__("provider rejected request")


def generate(config, system, prompt, max_tokens, timeout=None):
    endpoint = urlsplit(endpoints()[config["endpoint"]])
    connection_class = (
        http.client.HTTPSConnection
        if endpoint.scheme == "https"
        else http.client.HTTPConnection
    )
    kwargs = {"timeout": min(8, timeout) if timeout is not None else 8}
    if endpoint.scheme == "https":
        kwargs["context"] = ssl.create_default_context()
    connection = connection_class(endpoint.hostname, endpoint.port, **kwargs)

    transport = None

    def abort():
        try:
            if transport is not None:
                transport.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        finally:
            connection.close()

    timer = threading.Timer(timeout if timeout is not None else 10, abort)
    timer.daemon = True
    try:
        timer.start()
        connection.connect()
        transport = connection.sock
        payload = {
            "model": config["model"],
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "options": {"num_ctx": 4096, "num_predict": max_tokens},
            "keep_alive": "5m",
        }
        # Models supporting boolean thinking controls. Others retain their model default.
        if config["model"].split(":")[0].split("/")[-1] in ("qwen3",):
            payload["think"] = False
        connection.request(
            "POST",
            "/api/chat",
            body=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        if response.status != 200:  # Includes ALL redirects; never follow Location.
            raise ResponseError(response.status)
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("response too large")
        result = json.loads(raw)
        if result.get("done") is not True:
            raise ValueError("incomplete response")
        return {
            "answer": result["message"]["content"],
            "provider": "ollama",
            "model": config["model"],
            "input_tokens": result.get("prompt_eval_count"),
            "output_tokens": result.get("eval_count"),
        }
    finally:
        timer.cancel()
        connection.close()
