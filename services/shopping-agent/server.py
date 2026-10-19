import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from runtime import serve, request, text, HttpError
from llm_config import authenticate_service, validate_config, unconfigured
from agent import answer
from providers import invoke, ProviderError


def handle(req):
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
    config = validate_config(data.get("config"))
    if req.path == "/internal/llm/test":
        try:
            invoke(
                config,
                "Respond briefly to the connection check.",
                "Reply with OK.",
                data["revision"],
                "test",
            )
            return {"ok": True}
        except ProviderError as error:
            return {"ok": False, "errorCode": error.code}
    if config["provider"] == "none":
        return unconfigured()
    message = text(data.get("message"))
    products = request(
        os.getenv("CATALOGUE_URL", os.getenv("INGESTION_URL", "http://127.0.0.1:4108")) + "/api/products"
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
    )


if __name__ == "__main__":
    serve("shopping-agent", 4103, handle)
