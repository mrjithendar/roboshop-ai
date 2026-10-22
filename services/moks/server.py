import time
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from runtime import application as engine_application, configure_telemetry, log_event, request, text, HttpError
from llm_config import authenticate_service, validate_config, unconfigured, service_headers
from agent import answer
from providers import ProviderError
from routing import route
from deadlines import fetch
from provider_readiness import readiness


def handle(req):
    if req.path == "/ready" and req.method == "GET":
        try:
            service_url = os.getenv("CATALOGUE_URL", os.getenv("INGESTION_URL", "http://127.0.0.1:4108"))
            request(service_url + "/api/catalogue/ready", timeout=1)
            return {"status": "ready"}
        except HttpError:
            return {"status": "unavailable", "dependency": "catalogue"}, 503, []
    if req.path == "/internal/llm/readiness" and req.method == "GET":
        authenticate_service(req.headers)
        return readiness.snapshot()
    if req.path == "/api/chat":
        raise HttpError(403, "Use the authenticated gateway.")
    if req.path not in ("/internal/chat", "/internal/llm/test") or req.method != "POST":
        return
    authenticate_service(req.headers)
    data = req.body()
    allowed = {"config", "revision"} | (
        {"message", "unavailableSkus"} if req.path == "/internal/chat" else set()
    )
    if (
        set(data) - allowed
        or type(data.get("revision")) is not int
        or data["revision"] < 0
    ):
        raise HttpError(400, "Invalid private LLM request.")
    deadline = time.monotonic() + 16
    config = validate_config(data.get("config"))
    if req.path == "/internal/llm/test":
        try:
            route(
                config,
                "Respond briefly to the connection check.",
                "Reply with OK.",
                data["revision"],
                "test",
                deadline=deadline,
            )
            return {"ok": True}
        except ProviderError as error:
            return {"ok": False, "errorCode": error.code}
    def guard():
        active = fetch(os.getenv("AI_GATEWAY_URL", "http://ai-gateway:3000") + "/internal/llm/config",
                         headers=service_headers(), deadline=deadline, timeout=1)
        readiness.observe(active["config"], active["revision"])
        if active["revision"] != data["revision"] or active["config"] != config:
            raise ProviderError("unavailable")

    if config["provider"] == "none":
        return unconfigured()
    message = text(data.get("message"), maximum=3000)
    products = fetch(
        os.getenv("CATALOGUE_URL", os.getenv("INGESTION_URL", "http://127.0.0.1:4108")) + "/api/products", deadline=deadline, timeout=2
    )["products"]
    unavailable = data.get("unavailableSkus", [])
    if (
        not isinstance(unavailable, list)
        or len(unavailable) > 10000
        or not all(isinstance(s, str) for s in unavailable)
    ):
        raise HttpError(400, "Invalid availability filter.")
    return answer(
        [p for p in products if p["sku"] not in set(unavailable)],
        message,
        config,
        data["revision"],
        generate=lambda *args: route(*args, deadline=deadline, guard=guard),
        deadline=deadline,
    )


# Both interfaces share one process and listener. The widget retains session/origin
# checks; private engine routes retain the service bearer-token check.
def create_application():
    from widget import application as widget_application
    engine = engine_application("moks", handle)
    def application(environ, start_response):
        if environ.get("PATH_INFO") in ("/widget.js", "/available", "/chat", "/history"):
            return widget_application(environ, start_response)
        return engine(environ, start_response)
    return application


if __name__ == "__main__":
    from waitress import serve
    configure_telemetry("moks")
    log_event("service_starting", port=int(os.getenv("PORT", "4103")))
    # At most four widget requests wait on the gateway; leave capacity for its
    # authenticated engine callbacks and health requests on this same listener.
    serve(create_application(), host=os.getenv("HOST", "0.0.0.0"),
          port=int(os.getenv("PORT", "4103")), threads=16,
          max_request_body_size=65536, max_request_header_size=16384,
          channel_timeout=30, connection_limit=100, expose_tracebacks=False)
