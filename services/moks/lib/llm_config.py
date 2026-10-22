"""Strict server-side configuration; no credentials or arbitrary destinations."""

import ipaddress
import json
import os
import re
import secrets
from urllib.parse import urlsplit
from runtime import HttpError

UNCONFIGURED = "Please connect an LLM to get AI recommendations."


def endpoints():
    try:
        values = json.loads(os.getenv("OLLAMA_ENDPOINTS_JSON", "{}"))
        if not isinstance(values, dict) or len(values) > 20:
            raise ValueError()
        for alias, endpoint in values.items():
            if not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", alias):
                raise ValueError()
            if not isinstance(endpoint, str):
                raise ValueError()
            parsed = urlsplit(endpoint)
            # Literal IPv4 addresses prevent DNS rebinding and proxy bypasses.
            address = ipaddress.IPv4Address(parsed.hostname)
            allowed_private = any(
                address in ipaddress.ip_network(n)
                for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
            )
            if not (address.is_global or allowed_private):
                raise ValueError()
            if (
                parsed.scheme not in ("http", "https")
                or parsed.username
                or parsed.password
                or parsed.path not in ("", "/")
                or parsed.query
                or parsed.fragment
                or not parsed.port
                or not 1 <= parsed.port <= 65535
                or endpoint.rstrip("/") != f"{parsed.scheme}://{address}:{parsed.port}"
            ):
                raise ValueError()
        return {k: v.rstrip("/") for k, v in values.items()}
    except (ValueError, TypeError, AttributeError):
        raise HttpError(503, "Operator Ollama allowlist is invalid.") from None


def validate_config(value):
    if not isinstance(value, dict):
        raise HttpError(400, "Expected an LLM configuration object.")
    provider = value.get("provider")
    if "automaticFailover" in value or "fallback" in value:
        if value.get("provider") != "ollama" or type(value.get("automaticFailover")) is not bool:
            raise HttpError(400, "Failover requires Ollama primary and explicit consent.")
        primary = validate_config({k: v for k, v in value.items() if k not in ("automaticFailover", "fallback")})
        fallback = value.get("fallback")
        if not isinstance(fallback, dict) or fallback.get("provider") != "bedrock":
            raise HttpError(400, "Fallback must be Bedrock.")
        fallback = validate_config(fallback)
        return {**primary, "automaticFailover": value["automaticFailover"], "fallback": fallback}
    fields = {
        "none": {"provider"},
        "bedrock": {"provider", "region", "model"},
        "ollama": {"provider", "endpoint", "model"},
    }
    if (
        not isinstance(provider, str)
        or provider not in fields
        or set(value) != fields[provider]
    ):
        raise HttpError(400, "Invalid provider configuration fields.")
    if provider == "none":
        return {"provider": "none"}
    model = value["model"]
    if not isinstance(model, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}", model
    ):
        raise HttpError(400, "Invalid model or inference profile ID.")
    if provider == "bedrock":
        region = value["region"]
        if not isinstance(region, str) or not re.fullmatch(
            r"[a-z]{2}(?:-[a-z]+){1,2}-[0-9]", region
        ):
            raise HttpError(400, "Invalid AWS region.")
    else:
        if (
            not isinstance(value["endpoint"], str)
            or value["endpoint"] not in endpoints()
        ):
            raise HttpError(400, "Select an operator-approved Ollama endpoint.")
    return dict(value)


def service_headers():
    token = os.getenv("LLM_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise HttpError(503, "LLM service authentication is not configured.")
    return {"Authorization": "Bearer " + token}


def authenticate_service(headers):
    expected = service_headers()["Authorization"]
    supplied = headers.get("authorization", "")
    if not secrets.compare_digest(expected.encode(), supplied.encode()):
        raise HttpError(403, "Private service authentication required.")


def unconfigured():
    return {
        "answer": UNCONFIGURED,
        "products": [],
        "mode": "not-configured",
        "status": "not-configured",
        "provider": "none",
        "model": None,
        "input_tokens": None,
        "output_tokens": None,
        "notice": UNCONFIGURED,
    }
