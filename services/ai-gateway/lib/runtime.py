"""Shared HTTP, validation and telemetry for Python services."""

import base64
import contextvars
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from functools import wraps
from urllib.parse import urlsplit
from datetime import datetime, timezone
from http import HTTPStatus
from urllib.parse import parse_qs


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


ctx = contextvars.ContextVar("request_context", default=None)
exports = ThreadPoolExecutor(max_workers=2)
export_slots = threading.BoundedSemaphore(32)
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "robotshop")


def configure_telemetry(service):
    global SERVICE_NAME
    SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", service)


def trace_context(header=None):
    match = re.fullmatch(r"00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])", header or "")
    if match and (int(match[1], 16) == 0 or int(match[2], 16) == 0):
        match = None
    return {
        "traceId": match[1] if match else secrets.token_hex(16),
        "spanId": secrets.token_hex(8),
        "attributes": {},
        "flags": match[3] if match else "01",
        **({"parentSpanId": match[2]} if match else {}),
    }


def trace_header(context=None):
    context = context or ctx.get()
    return (
        f"00-{context['traceId']}-{context['spanId']}-{context.get('flags', '01')}"
        if context
        else None
    )


@contextmanager
def trace_span(name, kind=1, attributes=None, parent=None, service=None):
    previous = ctx.get()
    context = trace_context(parent or trace_header(previous))
    context["service"] = service or (previous or {}).get("service", SERVICE_NAME)
    context["kind"] = kind
    context["attributes"] = attributes or {}
    token = ctx.set(context)
    start, status = time.time_ns(), 200
    try:
        yield context
    except Exception as error:
        status = getattr(error, "status", 500)
        raise
    finally:
        telemetry(context["service"], context, start, name, status)
        ctx.reset(token)


def database_operation(name):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            with trace_span(
                "mongodb " + name,
                kind=3,
                attributes={"db.system.name": "mongodb", "db.operation.name": name},
            ):
                return fn(*args, **kwargs)

        return wrapped

    return decorate


def now():
    return datetime.now(timezone.utc)


def iso():
    return now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def encode(value):
    return json.dumps(
        value, default=lambda v: v.isoformat().replace("+00:00", "Z"), allow_nan=False
    ).encode()


def text(value, name="Message", maximum=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise HttpError(400, f"{name} must contain 1–{maximum} characters.")
    return value.strip()


def _request(url, data=None, headers=None, timeout=12, method=None):
    headers = {"content-type": "application/json", **(headers or {})}
    context = ctx.get()
    if context:
        headers["traceparent"] = trace_header(context)
    req = urllib.request.Request(
        url,
        data=encode(data) if data is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise HttpError(502, "A dependent service is unavailable.") from error
    except Exception as error:
        raise HttpError(
            503, "A dependent service is unavailable. Please try again."
        ) from error


def _upstream(url, data=None, headers=None, timeout=15, method=None):
    # Preserve payment/shipping validation errors without leaking upstream internals.
    req = urllib.request.Request(
        url,
        data=encode(data) if data is not None else None,
        headers={"content-type": "application/json", **(headers or {})},
        method=method,
    )
    context = ctx.get()
    if context:
        req.add_header("traceparent", trace_header(context))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            message = json.load(error).get(
                "error", "Dependent service rejected the request."
            )
        except Exception:
            message = "Dependent service rejected the request."
        raise HttpError(
            error.code,
            message if error.code < 500 else "Dependent service unavailable.",
        ) from error
    except Exception as error:
        raise HttpError(
            503, "Dependent service unavailable. Please try again."
        ) from error


def request(url, data=None, headers=None, timeout=12, method=None):
    with trace_span(
        "HTTP " + (method or ("POST" if data is not None else "GET")),
        kind=3,
        attributes={
            "server.address": urlsplit(url).hostname or "",
            "http.request.method": method or ("POST" if data is not None else "GET"),
        },
    ):
        return _request(url, data, headers, timeout, method)


def upstream(url, data=None, headers=None, timeout=15, method=None):
    with trace_span(
        "HTTP " + (method or ("POST" if data is not None else "GET")),
        kind=3,
        attributes={
            "server.address": urlsplit(url).hostname or "",
            "http.request.method": method or ("POST" if data is not None else "GET"),
        },
    ):
        return _upstream(url, data, headers, timeout, method)


class Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ["REQUEST_METHOD"]
        self.path = environ.get("PATH_INFO", "/")
        self.query = {
            k: v[-1]
            for k, v in parse_qs(
                environ.get("QUERY_STRING", ""), keep_blank_values=True
            ).items()
        }
        self.headers = {
            k[5:].lower().replace("_", "-"): v
            for k, v in environ.items()
            if k.startswith("HTTP_")
        }
        self.user = None
        self.cookies = []
        self._raw = None

    def raw(self, maximum=16384):
        if self._raw is None:
            try:
                size = int(self.environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                raise HttpError(400, "Invalid body length.")
            if size < 0 or size > maximum:
                raise HttpError(413, "Request is too large.")
            self._raw = self.environ["wsgi.input"].read(size)
        if len(self._raw) > maximum:
            raise HttpError(413, "Request is too large.")
        return self._raw

    def body(self):
        if not self.environ.get("CONTENT_TYPE", "").startswith("application/json"):
            raise HttpError(415, "Use application/json.")
        try:
            data = json.loads(
                self.raw(), parse_constant=lambda _: (_ for _ in ()).throw(ValueError())
            )
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except HttpError:
            raise
        except (ValueError, UnicodeError):
            raise HttpError(400, "Expected a JSON object.")

    def cookie(self, name, pattern):
        match = re.search(
            r"(?:^|;\s*)" + name + "=(" + pattern + r")(?:;|$)",
            self.headers.get("cookie", ""),
        )
        return match[1] if match else None

    def set_cookie(self, name, value, age):
        secure = (
            "; Secure" if os.getenv("PUBLIC_ORIGIN", "").startswith("https:") else ""
        )
        self.cookies.append(
            (
                "Set-Cookie",
                f'{name}={value or ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}',
            )
        )


def telemetry(service, context, start, route, status):
    if os.getenv("OTEL_SDK_DISABLED") == "true" or context.get("flags", "01") == "00":
        return
    targets = []
    if os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        targets.append((os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"], {}))
    if service == "shopping-agent" and all(
        os.getenv(k)
        for k in ("LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
    ):
        token = base64.b64encode(
            f"{os.environ['LANGFUSE_PUBLIC_KEY']}:{os.environ['LANGFUSE_SECRET_KEY']}".encode()
        ).decode()
        targets.append(
            (
                os.environ["LANGFUSE_BASE_URL"].rstrip("/")
                + "/api/public/otel/v1/traces",
                {
                    "Authorization": "Basic " + token,
                    "x-langfuse-ingestion-version": "4",
                },
            )
        )
    span = {
        "traceId": context["traceId"],
        "spanId": context["spanId"],
        "name": route,
        "kind": context.get("kind", 2),
        "flags": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(time.time_ns()),
        "status": {"code": 2 if status >= 500 else 1},
        "attributes": [
            {
                "key": k,
                "value": (
                    {"intValue": str(v)} if type(v) is int else {"stringValue": str(v)}
                ),
            }
            for k, v in {
                "http.response.status_code": status,
                **context["attributes"],
            }.items()
        ],
    }
    if context.get("parentSpanId"):
        span["parentSpanId"] = context["parentSpanId"]
    payload = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": service}},
                        {
                            "key": "service.version",
                            "value": {
                                "stringValue": os.getenv(
                                    "OTEL_SERVICE_VERSION", "0.2.0"
                                )
                            },
                        },
                        {
                            "key": "deployment.environment.name",
                            "value": {
                                "stringValue": os.getenv(
                                    "DEPLOYMENT_ENVIRONMENT", "development"
                                )
                            },
                        },
                    ]
                },
                "scopeSpans": [
                    {"scope": {"name": "robotshop.python"}, "spans": [span]}
                ],
            }
        ]
    }

    def send(url, headers):
        try:
            _request(url, payload, headers, timeout=2)
        except Exception:
            pass
        finally:
            export_slots.release()

    for url, headers in targets:
        if export_slots.acquire(blocking=False):
            exports.submit(send, url, headers)


def application(service, handler):
    counts, lock = Counter(), threading.Lock()
    duration = [0.0]

    def app(environ, start_response):
        start = time.time_ns()
        req = Request(environ)
        context = trace_context(req.headers.get("traceparent"))
        context["service"] = service
        token = ctx.set(context)
        status, headers = 200, [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
        ]
        route = (
            "/".join(req.path.split("/")[:3])
            if req.path.startswith("/api/")
            else "other"
        )
        if route not in [
            "/api/" + s
            for s in (
                "auth",
                "account",
                "admin",
                "settings",
                "catalogue",
                "products",
                "recommendations",
                "chat",
                "cart",
                "orders",
                "payments",
                "shipping",
                "ops",
                "status",
                "ready",
                "compare",
            )
        ]:
            route = "other"
        if req.path in ("/internal/chat", "/internal/llm/test"):
            route = req.path
        try:
            if req.path == "/health" and req.method == "GET":
                result = {"status": "ok", "service": service}
            elif req.path == "/metrics" and req.method == "GET":
                with lock:
                    rows = ["# TYPE robotshop_http_requests_total counter"] + [
                        f'robotshop_http_requests_total{{service="{service}",route="{r}",status="{s}"}} {n}'
                        for (r, s), n in counts.items()
                    ]
                    rows += [
                        "# TYPE robotshop_http_duration_seconds summary",
                        f'robotshop_http_duration_seconds_sum{{service="{service}"}} {duration[0]}',
                        f'robotshop_http_duration_seconds_count{{service="{service}"}} {sum(counts.values())}',
                    ]
                result = ("\n".join(rows) + "\n").encode()
                headers = [("Content-Type", "text/plain; version=0.0.4")]
            else:
                result = handler(req)
                if result is None:
                    raise HttpError(404, "Not found.")
                if isinstance(result, tuple):
                    result, status, extra = result
                    headers = extra + headers
        except HttpError as error:
            status, result = error.status, {
                "error": "The request could not be completed.",
                "requestId": context["traceId"],
            }
        except Exception:
            status, result = 500, {
                "error": "Internal service error.",
                "requestId": context["traceId"],
            }
        payload = result if isinstance(result, bytes) else encode(result)
        # Allow a static response's first content type/cache policy to override defaults.
        unique = []
        seen = set()
        for k, v in headers:
            if k.lower() not in seen:
                unique.append((k, v))
                seen.add(k.lower())
        start_response(
            f"{status} {HTTPStatus(status).phrase}",
            unique
            + req.cookies
            + [
                ("X-Request-ID", context["traceId"]),
                ("X-Content-Type-Options", "nosniff"),
                ("Referrer-Policy", "same-origin"),
                (
                    "Content-Security-Policy",
                    "default-src 'self'; img-src 'self' https://*.razorpay.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com; connect-src 'self' https://*.razorpay.com https://challenges.cloudflare.com; frame-src https://*.razorpay.com https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                ),
                ("Content-Length", str(len(payload))),
            ],
        )
        if req.path not in ("/health", "/metrics"):
            elapsed = (time.time_ns() - start) / 1e9
            with lock:
                counts[(route, status)] += 1
                duration[0] += elapsed
            print(
                json.dumps(
                    {
                        "service": service,
                        "route": route,
                        "status": status,
                        "durationMs": round(elapsed * 1000),
                        "traceId": context["traceId"],
                    }
                ),
                flush=True,
            )
            telemetry(service, context, start, req.method + " " + route, status)
        ctx.reset(token)
        return [b"" if req.method == "HEAD" else payload]

    return app


def serve(service, port, handler):
    from waitress import serve as run

    configure_telemetry(service)

    run(
        application(service, handler),
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", port)),
        threads=8,
        max_request_body_size=65536,
        max_request_header_size=16384,
        channel_timeout=30,
        connection_limit=100,
        expose_tracebacks=False,
    )
