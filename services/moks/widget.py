"""Optional, authenticated embeddable assistant adapter. No shared service imports."""
import json
import contextvars
import secrets
import re
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, wait
from http.cookies import SimpleCookie
import os
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

CHAT_URL = os.getenv('CHAT_URL', 'http://ai-gateway:3000/api/chat')
HEALTH_URLS = os.getenv('HEALTH_URLS', 'http://ai-gateway:3000/api/status,' + os.getenv('USER_URL', 'http://user-service:4109') + '/api/users/ready').split(',')
UPSTREAM_ORIGIN = os.getenv('UPSTREAM_ORIGIN', 'https://jithendar.com')
ALLOWED_ORIGINS = {s.strip() for s in os.getenv('ALLOWED_ORIGINS', 'https://jithendar.com').split(',')}
SLOTS = threading.BoundedSemaphore(4)
HEALTH_LOCK = threading.Lock()
HEALTH_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix='moks-health')
HEALTH_SLOTS = threading.BoundedSemaphore(3)
HEALTH = {'until': 0, 'ok': False, 'aiConfigured': False}
AI_SETUP_MESSAGE = 'Please connect an LLM to get results. A store administrator needs to configure Ollama or Amazon Bedrock.'
WIDGET = Path(__file__).with_name('widget.js').read_bytes()


def upstream(url, data=None, timeout=2, session=""):

    payload = None if data is None else json.dumps(data).encode()
    headers = {'Content-Type': 'application/json', 'Origin': UPSTREAM_ORIGIN}
    if data is not None or session:
        headers['Authorization'] = 'Bearer ' + os.getenv('LLM_SERVICE_TOKEN', '')
    if session:
        headers['Cookie'] = 'rs_auth=' + session
    if TRACE.get():
        headers['traceparent'] = '00-' + TRACE.get() + '-' + secrets.token_hex(8) + '-01'
    req = Request(url, data=payload, headers=headers)
    # URLs are operator-configured, never accepted from visitors. Forward only the explicitly validated rs_auth session cookie.
    with urlopen(req, timeout=timeout) as response:
        raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError('Oversized upstream response')
        return json.loads(raw)


def available():
    def check(url):
        try:
            result = upstream(url.strip(), timeout=1)
            return result if isinstance(result, dict) else {}
        except Exception:
            return False
        finally:
            HEALTH_SLOTS.release()
    with HEALTH_LOCK:
        if time.monotonic() >= HEALTH['until']:
            futures = []
            valid = 1 <= len(HEALTH_URLS) <= 3
            for url in HEALTH_URLS if valid else []:
                if HEALTH_SLOTS.acquire(blocking=False):
                    futures.append(HEALTH_POOL.submit(check, url))
                else:
                    valid = False
            wait(futures, timeout=1.5)
            HEALTH['ok'] = valid and all(f.done() and f.result() is not False for f in futures)
            HEALTH['aiConfigured'] = HEALTH['ok'] and not any(
                f.result().get('assistantMode') == 'not-configured' for f in futures)
            HEALTH['until'] = time.monotonic() + 10
        return HEALTH['ok']


def session_token(environ):
    if environ.get('HTTP_ORIGIN', UPSTREAM_ORIGIN) != UPSTREAM_ORIGIN:
        return ''
    try:
        cookie = SimpleCookie(environ.get('HTTP_COOKIE', ''))
        token = cookie['rs_auth'].value if 'rs_auth' in cookie else ''
        return token if re.fullmatch(r'[a-f0-9]{64}', token) else ''
    except Exception:
        return ''


def authenticated(environ):
    # Only same-origin embeddings use the shop session; external websites stay cookie-free.
    if environ.get('HTTP_ORIGIN', UPSTREAM_ORIGIN) != UPSTREAM_ORIGIN:
        return False
    try:
        cookies = SimpleCookie(environ.get('HTTP_COOKIE', ''))
        token = cookies['rs_auth'].value if 'rs_auth' in cookies else ''
        if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            return False
        req = Request(os.getenv('AUTH_URL', 'http://ai-gateway:3000/api/auth/me'),
                      headers={'Cookie': 'rs_auth=' + token})
        with urlopen(req, timeout=2) as response:
            result = json.loads(response.read(16384))
        return bool(result.get('user'))
    except Exception as error:
        log_event("authentication_dependency_failed", status=503, errorType=type(error).__name__)
        return False


def protection_ready():
    return len(os.getenv('LLM_SERVICE_TOKEN', '')) >= 32


RATE_LOCK = threading.Lock()
RATE = {'window': 0, 'count': 0}
def allow_attempt():
    # Global per-replica limit; no spoofable forwarded-IP headers or unbounded IP map.
    with RATE_LOCK:
        now = time.monotonic()
        if now - RATE['window'] >= 60:
            RATE.update(window=now, count=0)
        RATE['count'] += 1
        return RATE['count'] <= 30


def _application(environ, start_response):
    path, method = environ.get('PATH_INFO', ''), environ['REQUEST_METHOD']
    origin = environ.get('HTTP_ORIGIN', '')
    headers = [('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff')]
    if origin in ALLOWED_ORIGINS:
        headers += [('Access-Control-Allow-Origin', origin), ('Vary', 'Origin')]

    def send(code, data):
        reasons = {200: 'OK', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 413: 'Content Too Large', 429: 'Too Many Requests', 503: 'Service Unavailable'}
        body = b'' if code == 204 else json.dumps(data).encode()
        start_response(f'{code} {reasons[code]}', headers + [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
        return [body]

    if method == 'GET' and path == '/health':
        return send(200, {'ok': True})
    if method == 'GET' and path == '/ready':
        ok = protection_ready() and available()
        return send(200 if ok else 503, {'status': 'ready' if ok else 'unavailable'})
    if method == 'GET' and path == '/widget.js':
        start_response('200 OK', [('Content-Type', 'text/javascript; charset=utf-8'), ('Cache-Control', 'public, max-age=60'), ('X-Content-Type-Options', 'nosniff')])
        return [WIDGET]
    # Same-origin GET requests need not carry Origin. No personal data is exposed.
    if origin and origin not in ALLOWED_ORIGINS:
        return send(403, {'error': 'Origin not allowed'})
    if method == 'OPTIONS':
        if origin not in ALLOWED_ORIGINS:
            return send(403, {})
        headers.extend([('Access-Control-Allow-Methods', 'GET, POST'), ('Access-Control-Allow-Headers', 'Content-Type')])
        return send(204, None)
    if method == 'GET' and path == '/available':
        ok = protection_ready() and available()
        return send(200 if ok else 503, {'available': ok, 'authenticated': authenticated(environ) if ok else False, 'aiConfigured': HEALTH['aiConfigured'] if ok else False, 'message': AI_SETUP_MESSAGE if ok and not HEALTH['aiConfigured'] else ''})
    if method == 'GET' and path == '/history':
        token = session_token(environ)
        if not token or not protection_ready():
            return send(401, {'code': 'login-required', 'error': 'Please sign in to use Moks.'})
        try:
            return send(200, upstream(CHAT_URL.rstrip('/') + '/history', timeout=4, session=token))
        except HTTPError as error:
            return send(401 if error.code in (401, 403) else 503, {'error': 'Saved conversation unavailable.'})
        except Exception:
            return send(503, {'error': 'Saved conversation unavailable.'})
    if method != 'POST' or path != '/chat':
        return send(404, {})
    if origin not in ALLOWED_ORIGINS:
        return send(403, {})
    if not protection_ready():
        return send(503, {'error': 'Moks is not configured.'})
    if not allow_attempt():
        return send(429, {'error': 'Too many requests. Please wait a minute.'})
    if not authenticated(environ):
        return send(401, {'code': 'login-required', 'error': 'Please sign in to use Moks.'})
    try:
        size = int(environ.get('CONTENT_LENGTH') or 0)
        if size > 8192:
            return send(413, {})
        if size <= 0:
            return send(400, {})
        data = json.loads(environ['wsgi.input'].read(size))
        if not isinstance(data, dict) or not {'message'} <= set(data) or set(data) - {'message', 'context'} or not isinstance(data['message'], str) or not 1 <= len(data['message'].strip()) <= 1000:
            return send(400, {'error': 'Enter a question of up to 1,000 characters.'})
    except (ValueError, UnicodeError):
        return send(400, {})
    if not isinstance(data.get('context', ''), str) or len(data.get('context', '')) > 500:
        return send(400, {'error': 'Invalid conversation context.'})
    if not SLOTS.acquire(blocking=False):
        return send(429, {'error': 'Please try again shortly.'})
    try:
        message = data['message'].strip()
        # The gateway builds context from this account's Mongo history. Never trust
        # browser-supplied history or accept a caller-supplied user ID.
        result = upstream(CHAT_URL, {'message': message}, timeout=26, session=session_token(environ))
        if result.get('mode') == 'not-configured':
            return send(503, {'code': 'ai-not-configured', 'feature': 'moks', 'error': AI_SETUP_MESSAGE})
        if result.get('mode') == 'provider-unavailable':
            return send(503, {'code': 'feature-unavailable', 'feature': 'moks', 'error': result.get('answer', 'Assistant unavailable.')})
        return send(200, {'answer': result.get('answer', ''), 'notice': result.get('notice', ''), 'mode': result.get('mode', 'ai'),
                          'products': [{'name': p['name'], 'slug': p.get('slug') or p['sku'].lower()} for p in result.get('products', [])][:20]})
    except HTTPError as error:
        print(json.dumps({'service': 'moks', 'event': 'upstream_http_error', 'status': error.code}), flush=True)
        return send(401 if error.code in (401, 403) else 429 if error.code == 429 else 503, {'code': 'feature-unavailable', 'feature': 'moks', 'error': 'Assistant unavailable. Please try later.'})
    except Exception as error:
        log_event('request_failed', status=503, errorType=type(error).__name__)
        return send(503, {'code': 'feature-unavailable', 'feature': 'moks', 'error': 'Assistant unavailable.'})
    finally:
        SLOTS.release()



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


TRACE = contextvars.ContextVar('moks_trace', default=None)
def log_event(event, **fields):
    severity = 30 if fields.get('status',200) >= 400 else 20
    if severity < {'DEBUG':10,'INFO':20,'WARN':30,'ERROR':40}.get(os.getenv('LOG_LEVEL','INFO').upper(),20):
        return
    try:
        print(format_log({'timestamp':datetime.now(timezone.utc).isoformat(), 'service': 'moks',
            'level':'WARN' if fields.get('status',200) >= 400 else 'INFO', 'event':event,
            'traceId':TRACE.get(), **fields}), flush=True)
    except OSError:
        pass

def application(environ, start_response):
    incoming=re.fullmatch(r'00-([a-f0-9]{32})-[a-f0-9]{16}-0[01]',environ.get('HTTP_TRACEPARENT',''))
    trace=TRACE.set(incoming[1] if incoming and int(incoming[1],16) else secrets.token_hex(16))
    started=time.monotonic(); status=500
    path=environ.get('PATH_INFO','')
    route=path if path in ('/chat','/history','/available','/ready','/health','/widget.js') else 'other'
    def respond(line, headers):
        nonlocal status
        status=int(line.split()[0])
        return start_response(line, headers+[('X-Request-ID',TRACE.get())])
    try:
        return _application(environ,respond)
    finally:
        if status >= 400 or route not in ('/health','/ready','/available') or os.getenv('LOG_LEVEL') == 'DEBUG':
            log_event('request_completed',route=route,method=environ['REQUEST_METHOD'],status=status,errorCode=f'HTTP_{status}' if status >= 400 else 'OK',durationMs=round((time.monotonic()-started)*1000))
        TRACE.reset(trace)


