"""Human confirmation for consequential admin writes, bound to identity, arguments and time.

2026-07-28 connections use the stateless multi-round-trip flow: the first call returns an
elicitation request plus signed state; the client asks its user and retries with the answer.
Earlier connections use a server-initiated elicitation where the transport has a back-channel.
A client that cannot ask its user gets an error and nothing is changed.

This proves the confirmation came through the authenticated MCP client for these exact
arguments. It cannot prove a person clicked; the gateway still authorizes the write.
"""
import hashlib
import hmac
import json
import os
import secrets
import time

import mcp_types
from mcp_types.version import MODERN_PROTOCOL_VERSIONS
from fastmcp.server.elicitation import AcceptedElicitation
from fastmcp.tools import InputRequiredToolResult

KEY = "confirm"
SCHEMA = {"type": "object", "properties": {KEY: {"type": "boolean", "title": "Confirm this change"}}, "required": [KEY]}


class ConfirmationError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def digest(subject, tool, args):
    return hashlib.sha256(json.dumps([subject, tool, args], sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Confirmations:
    def __init__(self, ttl=120, key=None):
        self.ttl = ttl
        self.key = (key or os.getenv("MCP_CONFIRMATION_KEY") or secrets.token_hex(32)).encode()
        self.used = {}  # nonce -> expiry; single use within one replica

    def _sign(self, payload):
        return hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()

    def _state(self, subject, tool, args):
        body = json.dumps({"d": digest(subject, tool, args), "exp": int(time.time()) + self.ttl,
                           "n": secrets.token_hex(16)}, separators=(",", ":"))
        return body + "." + self._sign(body)

    def _consume(self, state, subject, tool, args):
        body, _, signature = (state or "").rpartition(".")
        if not body or not hmac.compare_digest(signature, self._sign(body)):
            raise ConfirmationError("confirmation_required")
        claims = json.loads(body)
        now = time.time()
        self.used = {n: exp for n, exp in self.used.items() if exp > now}
        if claims["exp"] < now or claims["n"] in self.used or not hmac.compare_digest(claims["d"], digest(subject, tool, args)):
            raise ConfirmationError("confirmation_required")
        self.used[claims["n"]] = claims["exp"]

    async def check(self, ctx, subject, tool, args, message):
        """Return None when confirmed, an InputRequiredToolResult to ask, or raise ConfirmationError."""
        version = getattr(getattr(ctx, "request_context", None), "protocol_version", None)
        if version in MODERN_PROTOCOL_VERSIONS:
            responses = ctx.input_responses
            if responses is None:
                request = mcp_types.ElicitRequest(params=mcp_types.ElicitRequestFormParams(message=message, requested_schema=SCHEMA))
                return InputRequiredToolResult(mcp_types.InputRequiredResult(
                    input_requests={KEY: request}, request_state=self._state(subject, tool, args)))
            self._consume(ctx.request_state, subject, tool, args)
            answer = responses.get(KEY)
            if not (isinstance(answer, mcp_types.ElicitResult) and answer.action == "accept"
                    and (answer.content or {}).get(KEY) is True):
                raise ConfirmationError("confirmation_declined")
            return None
        try:
            answer = await ctx.elicit(message, response_type=bool)
        except Exception:
            raise ConfirmationError("confirmation_unavailable") from None
        if not (isinstance(answer, AcceptedElicitation) and answer.data is True):
            raise ConfirmationError("confirmation_declined")
        return None
