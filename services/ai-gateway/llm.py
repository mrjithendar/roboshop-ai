"""Private Mongo configuration, atomic revision updates and bounded audit history."""

from pymongo import ReturnDocument, ReadPreference
from pymongo.write_concern import WriteConcern
from pymongo.errors import DuplicateKeyError
from runtime import HttpError, request, now
from auth import require_role
from llm_config import validate_config, endpoints, service_headers


class LLMConfiguration:
    def __init__(self, db, agent_url):
        self.collection = db.llm_configuration.with_options(
            read_preference=ReadPreference.PRIMARY,
            write_concern=WriteConcern(w="majority", wtimeout=5000),
        )
        self.agent_url = agent_url

    def current(self):
        record = self.collection.find_one({"_id": "active"})
        return record or {
            "_id": "active",
            "revision": 0,
            "config": {"provider": "none"},
            "audit": [],
        }

    def view(self, record):
        return {
            "config": record["config"],
            "revision": record["revision"],
            "status": (
                "not-configured"
                if record["config"]["provider"] == "none"
                else "configured"
            ),
            "verifiedAt": record.get("verifiedAt"),
            "endpoints": self.endpoint_names(),
            "audit": record.get("audit", [])[-20:],
        }

    def endpoint_names(self):
        try:
            return sorted(endpoints())
        except HttpError:
            return []  # A broken optional allowlist must not block disconnect/recovery.

    def test(self, config, revision):
        if config["provider"] == "none":
            raise HttpError(400, "Choose a provider before testing.")
        result = request(
            self.agent_url + "/internal/llm/test",
            {"config": config, "revision": revision},
            service_headers(),
            timeout=19,
        )
        if result.get("ok") is not True:
            safe = {
                "access-denied": "Provider access denied. Check the agent workload role.",
                "invalid-model": "Model unavailable or incompatible with this provider API.",
                "timeout": "Provider connection test timed out.",
                "throttled": "Provider is busy. Try again shortly.",
            }
            raise HttpError(
                503, safe.get(result.get("errorCode"), "LLM connection test failed.")
            )

    def routes(self, req):
        actor = require_role(req.user, ["superadmin"])
        if req.path == "/api/admin/llm/status" and req.method == "GET":
            current = self.current()
            config = current["config"]
            result = {"provider": config["provider"], "model": config.get("model"),
                      "revision": current["revision"],
                      "status": "not-configured" if config["provider"] == "none" else "configured",
                      "automaticFailover": config.get("automaticFailover", False),
                      "providers": {}}
            if config["provider"] != "none":
                try:
                    cached = request(self.agent_url + "/internal/llm/readiness", headers=service_headers(), timeout=1)
                    if cached.get("revision") == current["revision"]:
                        for provider, health in cached.get("providers", {}).items():
                            if provider in ("ollama", "bedrock") and isinstance(health, dict):
                                result["providers"][provider] = {
                                    "ready": health.get("ready") is True,
                                    "checkedAt": health.get("checkedAt") if type(health.get("checkedAt")) in (int, float) else None,
                                    "scope": health.get("scope") if health.get("scope") in ("model-listed", "tls-reachable") else "unknown"}
                except (HttpError, TypeError, ValueError):
                    pass  # Optional diagnostics cannot block configuration or disconnect.
            return result
        if req.path == "/api/admin/llm" and req.method == "GET":
            return self.view(self.current())
        if (req.path, req.method) not in (
            ("/api/admin/llm/test", "POST"),
            ("/api/admin/llm", "PUT"),
            ("/api/admin/llm/disconnect", "POST"),
        ):
            raise HttpError(404, "LLM endpoint not found.")
        data = req.body()
        disconnect = req.path.endswith("/disconnect")
        if set(data) != ({"revision"} if disconnect else {"revision", "config"}):
            raise HttpError(400, "Invalid LLM request fields.")
        revision = data.get("revision")
        if type(revision) is not int or revision < 0:
            raise HttpError(400, "A nonnegative configuration revision is required.")
        current = self.current()
        if revision != current["revision"]:
            raise HttpError(409, "LLM configuration changed. Refresh before saving.")
        config = {"provider": "none"} if disconnect else validate_config(data["config"])
        if req.path.endswith("/test"):
            self.test(config, revision)
            return {"ok": True, "activated": False, "revision": revision}
        # Policy activation must test BOTH exact configurations before the CAS commit.
        # Direct-provider saves/disconnect remain usable during an outage.
        if config.get("automaticFailover"):
            self.test(config, revision)
        stamp = now()
        event = {
            "actor": actor["id"],
            "timestamp": stamp,
            "revision": revision + 1,
            "summary": {
                "provider": config["provider"],
                "model": config.get("model"),
                "automaticFailover": config.get("automaticFailover", False),
                "fallback": config.get("fallback"),
                "action": "disconnect" if config["provider"] == "none" else "activate",
            },
        }
        # A single document update atomically commits config, revision and audit.
        update = {
            "$set": {
                "config": config,
                "updatedAt": stamp,
                "updatedBy": actor["id"],
                "verifiedAt": stamp if config.get("automaticFailover") else None,
            },
            "$inc": {"revision": 1},
            "$push": {"audit": {"$each": [event], "$slice": -1000}},
        }
        try:
            result = self.collection.find_one_and_update(
                {"_id": "active", "revision": revision},
                update,
                upsert=revision == 0,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            result = None
        if result is None:
            raise HttpError(409, "LLM configuration changed. Refresh before saving.")
        return self.view(result)
