"""Shared async gateway client: pooled connections, deadlines, bounded responses, safe retries."""
import json
import os
import re
import random
from urllib.parse import urlsplit

import anyio
import httpx2
from runtime import trace_span, propagation_headers, record_http_response, log_event
from trace_routes import http_name, route_template

MAX_RESPONSE_BYTES = 1_048_576
STATUS_CODES = {400: "invalid_argument", 413: "invalid_argument", 422: "invalid_argument", 401: "unauthenticated",
                403: "forbidden", 404: "not_found", 410: "not_found", 409: "conflict", 429: "rate_limited",
                408: "timeout", 504: "timeout"}
GENERIC = "The request could not be completed."


class GatewayError(Exception):
    """A classified outcome; `detail` is only ever the gateway's own public message."""
    def __init__(self, code, status=None, detail=None, transient=False, request_id=None):
        super().__init__(code)
        self.code, self.status, self.detail, self.transient = code, status or 503, detail, transient
        self.request_id = request_id if isinstance(request_id, str) and re.fullmatch(r"[a-f0-9]{32}", request_id) else None


class GatewayClient:
    def __init__(self, base_url=None, transport=None, origin=None, concurrency=None):
        self.base_url = (base_url or os.getenv("GATEWAY_URL", "http://127.0.0.1:3000")).rstrip("/")
        self.origin = origin or os.getenv("PUBLIC_ORIGIN", "http://localhost:3000")
        self.host = urlsplit(self.base_url).hostname or "gateway"
        self._transport = transport
        self._client = None
        self._concurrency = concurrency or int(os.getenv("MCP_GATEWAY_CONCURRENCY", "16"))
        self._limiter = None

    def _http(self):
        # Created lazily inside the running event loop; closed by the server lifespan.
        if self._client is None:
            self._client = httpx2.AsyncClient(
                base_url=self.base_url, transport=self._transport, follow_redirects=False, trust_env=False,
                timeout=httpx2.Timeout(5.0, connect=2.0),
                limits=httpx2.Limits(max_connections=self._concurrency, max_keepalive_connections=8))
            self._limiter = anyio.CapacityLimiter(self._concurrency)
        return self._client

    async def aclose(self):
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    async def request(self, method, path, *, deadline, params=None, body=None, session=None, retry=False, accept=()):
        """One call, or two for a retry-eligible read; both share the caller's deadline."""
        for attempt in (1, 2):
            try:
                return await self._once(method, path, deadline, params, body, session, accept)
            except GatewayError as error:
                pause = 0.1 + random.random() / 10
                if attempt == 2 or not (retry and method == "GET" and error.transient) \
                        or deadline - anyio.current_time() < pause + 0.25:
                    raise
                log_event("dependency_retry_scheduled", "WARN", dependency=self.host, attempt=2, maxAttempts=2,
                          delayMs=round(pause * 1000), reason="transient_read_failure")
                await anyio.sleep(pause)

    async def _once(self, method, path, deadline, params, body, session, accept):
        remaining = deadline - anyio.current_time()
        if remaining <= 0:
            raise GatewayError("timeout", 504)
        client = self._http()
        # Only these headers leave the server: never client headers, cookies or credentials.
        headers = {"accept": "application/json"}
        if body is not None:
            headers["origin"] = self.origin  # The gateway's CSRF check for state changes.
        if session:
            headers["cookie"] = "rs_auth=" + session
        with trace_span(http_name(method, path), kind=3, attributes={
            "server.address": self.host, "url.template": route_template(path), "http.request.method": method,
        }):
            headers.update(propagation_headers())
            try:
                with anyio.fail_after(remaining):
                    async with self._limiter:
                        async with client.stream(method, path, params=params, json=body, headers=headers,
                                                 timeout=httpx2.Timeout(min(remaining, 10.0), connect=min(remaining, 2.0))) as response:
                            record_http_response(response.status_code)
                            raw = await _read_bounded(response)
            except TimeoutError:
                raise GatewayError("timeout", 504) from None
            except httpx2.TimeoutException as error:
                # A write may have reached the gateway: never mark it transient.
                raise GatewayError("timeout", 504, transient=method == "GET") from error
            except httpx2.TransportError as error:
                raise GatewayError("dependency_unavailable", 503, transient=method == "GET"
                                   or isinstance(error, httpx2.ConnectError)) from error
            try:
                data = json.loads(raw) if raw else {}
            except ValueError:
                data = None
            status = response.status_code
            if 200 <= status < 300 or status in accept:
                if not isinstance(data, dict):
                    raise GatewayError("invalid_response", 502)
                return data
            message = data.get("error") if isinstance(data, dict) else None
            detail = message[:300] if isinstance(message, str) and message != GENERIC and status in (400, 404, 409) else None
            raise GatewayError(STATUS_CODES.get(status, "dependency_unavailable"), status, detail,
                               transient=status in (502, 503, 504), request_id=response.headers.get("x-request-id"))


async def _read_bounded(response):
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
        raise GatewayError("invalid_response", 502)
    data = bytearray()
    async for chunk in response.aiter_bytes():
        data.extend(chunk)
        if len(data) > MAX_RESPONSE_BYTES:
            raise GatewayError("invalid_response", 502)
    return bytes(data)
