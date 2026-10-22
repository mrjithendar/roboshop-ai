"""Shared HTTP, validation and telemetry for Python services."""

from trace_routes import route_template, quiet_route, http_name
import atexit
import queue
import hashlib
import hmac
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


SAFE_ERRORS = {'Account security is not configured. Contact the store.': 'ACCOUNT_SECURITY_NOT_CONFIGURED',
 'Password recovery email is not configured. Contact the store.': 'RESET_EMAIL_NOT_CONFIGURED',
 'Password recovery email credentials are not configured. Contact the store.': 'RESET_EMAIL_CREDENTIALS_MISSING',
 'Invalid email or password.': 'AUTH_INVALID_CREDENTIALS',
 'Please log in to continue.': 'AUTH_REQUIRED',
 'Complete a fresh human verification challenge.': 'CHALLENGE_REQUIRED',
 'Challenge expired, reused or invalid. Complete a fresh challenge.': 'CHALLENGE_INVALID',
 'Challenge expired, reused or invalid. Complete a fresh challenge and retry.': 'CHALLENGE_INVALID',
 'Challenge already used. Complete a fresh challenge.': 'CHALLENGE_REUSED',
 'Challenge verification failed or timed out. Complete a fresh challenge and retry.': 'CHALLENGE_UNAVAILABLE',
 'Sign-in verification is misconfigured. Please contact the store administrator.': 'CHALLENGE_MISCONFIGURED',
 'Authentication protection is unavailable. Please try later.': 'CHALLENGE_MISCONFIGURED',
 'Verification service is temporarily unavailable. Please try again later.': 'CHALLENGE_UNAVAILABLE',
 'Too many authentication attempts. Wait 15 minutes before retrying.': 'AUTH_RATE_LIMITED',
 'A dependent service is unavailable.': 'DEPENDENCY_UNAVAILABLE',
 'A dependent service is unavailable. Please try again.': 'DEPENDENCY_UNAVAILABLE',
 'Dependent service unavailable.': 'DEPENDENCY_UNAVAILABLE',
 'Dependent service unavailable. Please try again.': 'DEPENDENCY_UNAVAILABLE'}

def error_details(error):
    """Only allowlisted messages; exception text may contain tokens or user data."""
    code = SAFE_ERRORS.get(str(error), "HTTP_" + str(getattr(error, "status", 500)))
    details = {"errorCode": code, "reason": str(error) if str(error) in SAFE_ERRORS else "See errorCode and source; sensitive exception text omitted"}
    if error.__traceback__:
        tb = error.__traceback__
        while tb.tb_next:
            tb = tb.tb_next
        details["source"] = tb.tb_frame.f_code.co_name + ":" + str(tb.tb_lineno)
    return details

class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


ctx = contextvars.ContextVar("request_context", default=None)
class BoundedExports:
    """Daemon workers; at most 32 queued exports and two seconds of shutdown drain."""
    def __init__(self):
        self.queue = queue.Queue(32)
        self.closed = False
        for _ in range(2): threading.Thread(target=self.run, daemon=True, name='otel-export').start()
    def run(self):
        while True:
            fn, args = self.queue.get()
            try: fn(*args)
            except Exception: pass
            finally: self.queue.task_done()
    def submit(self, fn, *args):
        if self.closed: raise RuntimeError('Exporter closed')
        try: self.queue.put_nowait((fn,args))
        except queue.Full: raise RuntimeError('Exporter full') from None
    def shutdown(self, timeout=2):
        self.closed = True
        end = time.monotonic() + timeout
        while self.queue.unfinished_tasks and time.monotonic() < end: time.sleep(0.01)
exports = BoundedExports()
atexit.register(exports.shutdown)
export_slots = threading.BoundedSemaphore(32)
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "roboshop")



OPERATIONS = frozenset("/api/auth/login /api/auth/register /api/auth/logout /api/auth/challenge /api/auth/me /api/auth/mfa/verify /api/auth/password/request /api/auth/password/reset /api/account/profile /api/account/purchases /api/payments/config /api/payments/orders /api/payments/quote /api/payments/verify /api/payments/current /api/payments/status /api/payments/webhook /api/shipping/quote /api/admin/llm /api/admin/llm/test /api/admin/llm/disconnect /api/admin/llm/status /api/chat /api/cart /internal/session /internal/limit /internal/address /internal/purchase /internal/verified-purchase /internal/request /internal/chat /internal/llm/config /internal/llm/test".split())
def operation_name(path):
    if re.fullmatch(r"/internal/carts/[a-f0-9-]{36}(/clear|/clear-checked)?", path):
        return "/internal/carts/{cartId}" + ("/clear" if path.endswith(("/clear", "/clear-checked")) else "")
    return path if path in OPERATIONS else "other"

# Service-local structured logs; never serialize arbitrary request/exception data.
LOG_FIELDS = frozenset("method route status durationMs dependency operation errorType errorCode provider model reason revision backend port state orderId traceId source attempt maxAttempts delayMs username userId outcome".split())
LOG_MESSAGES = {'authentication_challenge_passed': 'Human verification passed',
 'authentication_challenge_rejected': 'Human verification rejected',
 'cart_update_rejected': 'Cart update rejected; refresh the cart',
 'cart_updated': 'Cart saved',
 'checkout_payment_captured': 'Payment captured and order confirmed',
 'checkout_reconciliation_required': 'Payment outcome uncertain; reconciliation required',
 'checkout_reserved': 'Checkout reserved; creating payment order',
 'delivery_retry': 'Kafka delivery not confirmed; message retained for retry',
 'dependency_call_completed': 'Dependency request completed',
 'dependency_retry_scheduled': 'Dependency unavailable; retrying a safe read',
 'event_delivered': 'Order event delivered to Kafka',
 'invalid_event_quarantined': 'Invalid order event moved to quarantine',
 'order_event_published': 'Order event delivered to RabbitMQ',
 'request_completed': 'HTTP request completed',
 'request_failed': 'Request failed',
 'request_rejected': 'Request rejected',
 'service_listening': 'Service listening for requests',
 'service_starting': 'Starting service',
 'service_stopping': 'Stopping service',
 'user_logged_in': 'User logged in successfully',
 'user_logged_out': 'User logged out',
 'user_login_failed': 'User failed to log in',
 'user_login_mfa_required': 'Password accepted; waiting for second-factor verification',
 'user_registered': 'User account created'}

def format_log(record):
    message = LOG_MESSAGES.get(record["event"], record["event"].replace("_", " ").capitalize())
    record = dict(record, message=message)
    if os.getenv("LOG_FORMAT", "json").lower() != "text":
        return json.dumps(record, allow_nan=False)
    # JSON-quote all field values to keep untrusted newlines/control characters
    # on one physical line. Do not include arbitrary request/exception objects.
    details = " ".join(f"{key}={json.dumps(value, ensure_ascii=True, allow_nan=False)}" for key, value in record.items() if key not in ("timestamp", "level", "service", "message", "event"))
    return f'{record["timestamp"]} {record["level"]:<5} [{record["service"]}] {message} | event={record["event"]} {details}'.rstrip()

def log_event(event, level="INFO", **fields):
    if fields.get("status", 0) >= 500:
        level = "ERROR"
    levels = {"DEBUG": 10, "INFO": 20, "WARN": 30, "ERROR": 40}
    if levels.get(level, 20) < levels.get(os.getenv("LOG_LEVEL", "INFO").upper(), 20):
        return
    context = ctx.get() or {}
    record = {"timestamp": datetime.now(timezone.utc).isoformat(), "level": level,
              "service": context.get("service", SERVICE_NAME), "event": event}
    if context.get("traceId"):
        record["traceId"] = context["traceId"]
        record["trace_id"] = context["traceId"]
        record["span_id"] = context.get("spanId", "")
    for identity in ('username','userId'):
        value = fields.pop(identity, None)
        key = os.getenv('TELEMETRY_ID_KEY')
        if value and key: record[identity + 'Hash'] = hmac.new(key.encode(), str(value).encode(), hashlib.sha256).hexdigest()
    record.update({k: v for k, v in fields.items() if k in LOG_FIELDS and isinstance(v, (str, int, float, bool))})
    try:
        print(format_log(record), flush=True)
    except (OSError, ValueError):
        pass  # A logging sink must never change a commerce outcome.


def configure_telemetry(service):
    global SERVICE_NAME
    SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", service)


def valid_tracestate(value):
    # W3C limits; reject control characters and malformed/duplicate members.
    if not isinstance(value, str) or len(value) > 512: return ''
    members = value.split(',')
    if len(members) > 32: return ''
    keys = set()
    for member in members:
        pair = member.strip().split('=', 1)
        if len(pair) != 2 or not re.fullmatch(r'[a-z0-9][a-z0-9_*/@.-]{0,255}', pair[0]) or pair[0] in keys or not re.fullmatch(r'[\x20-\x2b\x2d-\x3c\x3e-\x7e]{1,256}', pair[1]) or pair[1].endswith(' '): return ''
        keys.add(pair[0])
    return ','.join(m.strip() for m in members)

def propagation_headers():
    current = ctx.get() or {}
    return ({'traceparent': trace_header(), **({'tracestate': current['tracestate']} if current.get('tracestate') else {})} if current else {})

def business_operation(name):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if (ctx.get() or {}).get('attributes',{}).get('roboshop.business.operation') == name:
                return fn(*args, **kwargs)
            with trace_span(name,attributes={'roboshop.business.operation':name}): return fn(*args, **kwargs)
        return wrapped
    return decorate

def trace_context(header=None, tracestate=None):
    match = re.fullmatch(r"00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])", header or "")
    if match and (int(match[1], 16) == 0 or int(match[2], 16) == 0):
        match = None
    return {
        "traceId": match[1] if match else secrets.token_hex(16),
        "spanId": secrets.token_hex(8),
        "attributes": {},
        "tracestate": valid_tracestate(tracestate) if match else "",
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
def trace_span(name, kind=1, attributes=None, parent=None, service=None, tracestate=None):
    previous = ctx.get()
    context = trace_context(parent or trace_header(previous), tracestate if parent else (previous or {}).get("tracestate"))
    context["service"] = service or (previous or {}).get("service", SERVICE_NAME)
    context["kind"] = kind
    context["attributes"] = attributes if attributes is not None else {}
    context["quiet"] = (previous or {}).get("quiet", False) or quiet_route(context["attributes"].get("url.template", ""))
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
                name,
                kind=1,
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


def record_http_response(status=None):
    """Actual transport metadata, independent of the sanitized caller error.

    Reset before each attempt so a later connection failure cannot retain an
    earlier retry response. Never attach transport metadata to a server span.
    """
    context = ctx.get()
    if context and context.get("kind") == 3:
        attributes = context.setdefault("attributes", {})
        attributes.pop("http.response.status_code", None)
        if type(status) is int and 100 <= status <= 599:
            attributes["http.response.status_code"] = status


def _request(url, data=None, headers=None, timeout=12, method=None):
    headers = {"content-type": "application/json", **(headers or {})}
    context = ctx.get()
    if context:
        headers.update(propagation_headers())
    req = urllib.request.Request(
        url,
        data=encode(data) if data is not None else None,
        headers=headers,
        method=method,
    )
    record_http_response()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            record_http_response(getattr(response, "status", None))
            return json.load(response)
    except urllib.error.HTTPError as error:
        record_http_response(error.code)
        log_event("dependency_response_rejected", "WARN", dependency=urlsplit(url).hostname or "unknown", status=error.code)
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
        for key, value in propagation_headers().items(): req.add_header(key, value)
    record_http_response()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            record_http_response(getattr(response, "status", None))
            return json.load(response)
    except urllib.error.HTTPError as error:
        record_http_response(error.code)
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


def _retry_read(fn, url, data, headers, timeout, method):
    # One retry, only read-only calls and transient transport/server failures.
    # Both attempts and backoff share the original time budget.
    end = time.monotonic() + timeout
    verb = method or ("POST" if data is not None else "GET")
    for attempt in range(2):
        try:
            return fn(url, data, headers, max(0.001, end-time.monotonic()), method)
        except HttpError as error:
            cause = error.__cause__
            transient = (isinstance(cause, urllib.error.HTTPError) and cause.code in (502, 503, 504)) or (isinstance(cause, (urllib.error.URLError, TimeoutError)) and not isinstance(cause, urllib.error.HTTPError))
            pause = 0.1 + secrets.randbelow(100) / 1000
            if attempt or verb not in ("GET", "HEAD") or data is not None or not transient or end-time.monotonic() < pause + 0.1 or urlsplit(url).path.endswith(("/health", "/ready", "/metrics")):
                raise
            log_event("dependency_retry_scheduled", "WARN", dependency=urlsplit(url).hostname or "unknown", method=verb, attempt=2, maxAttempts=2, delayMs=round(pause*1000), reason="transient_read_failure")
            time.sleep(pause)


def request(url, data=None, headers=None, timeout=12, method=None):
    with trace_span(
        http_name(method or ("POST" if data is not None else "GET"), url),
        kind=3,
        attributes={
            "server.address": urlsplit(url).hostname or "",
            "url.template": route_template(url),
            "http.request.method": method or ("POST" if data is not None else "GET"),
        },
    ):
        started = time.monotonic()
        status, error_type = 200, None
        try:
            return _retry_read(_request, url, data, headers, timeout, method)
        except Exception as error:
            status, error_type = getattr(error, "status", 503), type(error.__cause__ or error).__name__
            raise
        finally:
            log_event("dependency_call_completed", "WARN" if status >= 400 else "DEBUG" if urlsplit(url).path.endswith(("/ready", "/health", "/metrics")) else "INFO",
                      dependency=urlsplit(url).hostname or "unknown", method=method or ("POST" if data is not None else "GET"),
                      status=status, durationMs=round((time.monotonic()-started)*1000), errorType=error_type)


def upstream(url, data=None, headers=None, timeout=15, method=None):
    with trace_span(
        http_name(method or ("POST" if data is not None else "GET"), url),
        kind=3,
        attributes={
            "server.address": urlsplit(url).hostname or "",
            "url.template": route_template(url),
            "http.request.method": method or ("POST" if data is not None else "GET"),
        },
    ):
        started = time.monotonic()
        status, error_type = 200, None
        try:
            return _upstream(url, data, headers, timeout, method)
        except Exception as error:
            status, error_type = getattr(error, "status", 503), type(error.__cause__ or error).__name__
            raise
        finally:
            log_event("dependency_call_completed", "WARN" if status >= 400 else "DEBUG" if urlsplit(url).path.endswith(("/ready", "/health", "/metrics")) else "INFO",
                      dependency=urlsplit(url).hostname or "unknown", method=method or ("POST" if data is not None else "GET"),
                      status=status, durationMs=round((time.monotonic()-started)*1000), errorType=error_type)


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


def safe_attributes(attributes):
    blocked = ('authorization','cookie','password','secret','token','prompt','completion','input.value','output.value','db.statement','db.query','url.full','url.query','http.url','http.target','client.address','enduser.')
    result = {}
    for key,value in attributes.items():
        # Token usage is a numeric measure, not a bearer token.
        usage = key.startswith('gen_ai.usage.') and type(value) is int and value >= 0
        if not usage and any(part in key.lower() for part in blocked): continue
        if key in ('langfuse.observation.input','langfuse.observation.output') and os.getenv('LANGFUSE_CAPTURE_CONTENT') != 'synthetic-only': continue
        if isinstance(value,(str,int,float,bool)):
            result[key] = value[:16000] if isinstance(value,str) else value
    return result

def telemetry(service, context, start, route, status):
    if os.getenv("OTEL_SDK_DISABLED") == "true" or context.get("flags", "01") == "00":
        return
    if status < 400 and (context.get('quiet') or quiet_route(context.get('attributes', {}).get('http.route') or context.get('attributes', {}).get('url.template', ''))):
        return
    targets = []
    if os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        targets.append((os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"], {}))
    if service == "moks" and (context.get("attributes", {}).get("langfuse.observation.type") or context.get("attributes", {}).get("gen_ai.request.model")) and all(
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
        "flags": int(context.get("flags", "01"), 16),
        "traceState": context.get("tracestate", ""),
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(context.get("endTimeUnixNano") or time.time_ns()),
        "status": {"code": 2 if status >= 400 else 0},
        "attributes": [
            {
                "key": k,
                "value": (
                    {"intValue": str(v)} if type(v) is int else {"stringValue": str(v)}
                ),
            }
            for k, v in {
                **({"http.response.status_code": status} if context.get("kind", 2) == 2 else {}),
                **safe_attributes(context["attributes"]),
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
                        {"key": "service.namespace", "value": {"stringValue": os.getenv("OTEL_SERVICE_NAMESPACE", "roboshop-ai")}},
                        {"key": "service.instance.id", "value": {"stringValue": os.getenv("POD_UID") or os.getenv("HOSTNAME", "local")}},
                        {
                            "key": "service.version",
                            "value": {
                                "stringValue": os.getenv(
                                    "OTEL_SERVICE_VERSION", "unknown"
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
                    {"scope": {"name": "roboshop.python"}, "spans": [span]}
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
            try:
                exports.submit(send, url, headers)
            except RuntimeError:
                export_slots.release()  # Shutdown/disabled exporter cannot fail commerce.


def application(service, handler):
    counts, lock = Counter(), threading.Lock()
    duration = [0.0]

    def app(environ, start_response):
        start = time.time_ns()
        req = Request(environ)
        context = trace_context(req.headers.get("traceparent"), req.headers.get("tracestate"))
        context["service"] = service
        token = ctx.set(context)
        status, headers = 200, [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
        ]
        route = route_template(req.path)
        context['attributes'].update({'http.route': route, 'http.request.method': req.method})
        context['quiet'] = quiet_route(route)
        try:
            if req.path == "/health" and req.method == "GET":
                result = {"status": "ok", "service": service}
            elif req.path == "/metrics" and req.method == "GET":
                with lock:
                    rows = ["# TYPE roboshop_http_requests_total counter"] + [
                        f'roboshop_http_requests_total{{service="{service}",route="{r}",status="{s}"}} {n}'
                        for (r, s), n in counts.items()
                    ]
                    rows += [
                        "# TYPE roboshop_http_duration_seconds summary",
                        f'roboshop_http_duration_seconds_sum{{service="{service}"}} {duration[0]}',
                        f'roboshop_http_duration_seconds_count{{service="{service}"}} {sum(counts.values())}',
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
            log_event("request_rejected", "WARN", method=req.method, route=route, status=error.status, errorType=type(error).__name__, operation=operation_name(req.path), **error_details(error))
            status, result = error.status, {
                "error": str(error),
                "code": error_details(error)["errorCode"],
                "requestId": context["traceId"],
            }
        except Exception as error:
            log_event("request_failed", "ERROR", method=req.method, route=route, status=500, errorType=type(error).__name__, **error_details(error))
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
        if not quiet_route(route) or status >= 400:
            elapsed = (time.time_ns() - start) / 1e9
            with lock:
                counts[(route, status)] += 1
                duration[0] += elapsed
            probe = req.path.endswith("/ready")
            log_event("request_completed", "WARN" if status >= 400 else "DEBUG" if probe else "INFO",
                      method=req.method, route=route, operation=operation_name(req.path), outcome="failure" if status >= 400 else "success", status=status, durationMs=round(elapsed * 1000))
            telemetry(service, context, start, http_name(req.method, req.path), status)
        ctx.reset(token)
        return [b"" if req.method == "HEAD" else payload]

    return app


def serve(service, port, handler):
    from waitress import serve as run

    configure_telemetry(service)

    log_event("service_starting", port=int(os.getenv("PORT", port)))
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
