import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python-common"))
from runtime import serve, request, text, ctx
from agent import answer


def handle(req):
    if req.path != "/api/chat" or req.method != "POST":
        return
    data = req.body()
    message = text(data.get("message"))
    products = request(
        os.getenv("INGESTION_URL", "http://127.0.0.1:4101") + "/api/products"
    )["products"]
    unavailable = data.get("unavailableSkus", [])
    unavailable = (
        {s for s in unavailable if isinstance(s, str)}
        if isinstance(unavailable, list)
        else set()
    )
    result = answer([p for p in products if p["sku"] not in unavailable], message)
    attributes = ctx.get()["attributes"]
    attributes["robotshop.assistant.mode"] = result["mode"]
    attributes["langfuse.observation.type"] = (
        "generation" if result["mode"] == "ai" else "span"
    )
    if result.get("model"):
        attributes.update(
            {
                "gen_ai.request.model": result["model"],
                "gen_ai.system": "openai",
                "gen_ai.usage.input_tokens": result["usage"].get("input_tokens", 0),
                "gen_ai.usage.output_tokens": result["usage"].get("output_tokens", 0),
            }
        )
    return result


if __name__ == "__main__":
    serve("shopping-agent", 4103, handle)
