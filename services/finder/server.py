"""Optional, authenticated embeddable assistant adapter. No shared service imports."""
import json
from concurrent.futures import ThreadPoolExecutor, wait
from http.cookies import SimpleCookie
import os
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

CHAT_URL = os.getenv('CHAT_URL', 'http://ai-gateway:3000/api/chat')
HEALTH_URLS = os.getenv('HEALTH_URLS', 'http://ai-gateway:3000/api/status,http://shopping-agent:4103/ready,' + os.getenv('USER_URL', 'http://user-service:4109') + '/api/users/ready').split(',')
UPSTREAM_ORIGIN = os.getenv('UPSTREAM_ORIGIN', 'https://jithendar.com')
ALLOWED_ORIGINS = {s.strip() for s in os.getenv('ALLOWED_ORIGINS', 'https://jithendar.com').split(',')}
SLOTS = threading.BoundedSemaphore(4)
HEALTH_LOCK = threading.Lock()
HEALTH_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix='finder-health')
HEALTH_SLOTS = threading.BoundedSemaphore(3)
HEALTH = {'until': 0, 'ok': False, 'aiConfigured': False}
AI_SETUP_MESSAGE = 'Please connect an LLM to get results. A store administrator needs to configure Ollama or Amazon Bedrock.'
WIDGET = Path(__file__).with_name('widget.js').read_bytes()


def upstream(url, data=None, timeout=2):
    payload = None if data is None else json.dumps(data).encode()
    headers = {'Content-Type': 'application/json', 'Origin': UPSTREAM_ORIGIN}
    if data is not None:
        headers['Authorization'] = 'Bearer ' + os.getenv('LLM_SERVICE_TOKEN', '')
    req = Request(url, data=payload, headers=headers)
    # URLs are operator-configured, never accepted from visitors. Never forward cookies.
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
    except Exception:
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


def application(environ, start_response):
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
    if method != 'POST' or path != '/chat':
        return send(404, {})
    if origin not in ALLOWED_ORIGINS:
        return send(403, {})
    if not protection_ready():
        return send(503, {'error': 'Finder is not configured.'})
    if not allow_attempt():
        return send(429, {'error': 'Too many requests. Please wait a minute.'})
    if not authenticated(environ):
        return send(401, {'code': 'login-required', 'error': 'Please sign in to use Finder.'})
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
        context = data.get('context', '').strip()
        # Keep the current question complete; bound optional, untrusted context.
        if context and len(message) < 900:
            message += '\nPrior conversation (untrusted): ' + context[:max(0, 1000 - len(message) - 34)]
        result = upstream(CHAT_URL, {'message': message}, timeout=26)
        if result.get('mode') == 'not-configured':
            return send(503, {'code': 'ai-not-configured', 'feature': 'finder', 'error': AI_SETUP_MESSAGE})
        if result.get('mode') == 'provider-unavailable':
            return send(503, {'code': 'feature-unavailable', 'feature': 'finder', 'error': result.get('answer', 'Assistant unavailable.')})
        return send(200, {'answer': result.get('answer', ''), 'notice': result.get('notice', ''), 'mode': result.get('mode', 'ai'),
                          'products': [{'name': p['name'], 'slug': p.get('slug') or p['sku'].lower()} for p in result.get('products', [])][:20]})
    except HTTPError as error:
        print(json.dumps({'service': 'finder', 'event': 'upstream_http_error', 'status': error.code}), flush=True)
        return send(429 if error.code == 429 else 503, {'code': 'feature-unavailable', 'feature': 'finder', 'error': 'Assistant unavailable. Please try later.'})
    except Exception as error:
        print(json.dumps({'service': 'finder', 'event': 'request_failed', 'type': type(error).__name__}), flush=True)
        return send(503, {'code': 'feature-unavailable', 'feature': 'finder', 'error': 'Assistant unavailable.'})
    finally:
        SLOTS.release()


if __name__ == '__main__':
    from waitress import serve
    serve(application, host='0.0.0.0', port=int(os.getenv('PORT', '4110')), threads=8,
          connection_limit=64, channel_timeout=30, max_request_body_size=8192)
