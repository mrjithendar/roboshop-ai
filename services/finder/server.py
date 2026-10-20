"""Optional, cookie-free embeddable assistant adapter. No shared service imports."""
import json
import os
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit
from datetime import datetime, timezone

CHAT_URL = os.getenv('CHAT_URL', 'http://ai-gateway:3000/api/chat')
HEALTH_URLS = os.getenv('HEALTH_URLS', 'http://ai-gateway:3000/api/status,http://shopping-agent:4103/health').split(',')
UPSTREAM_ORIGIN = os.getenv('UPSTREAM_ORIGIN', 'https://jithendar.com')
ALLOWED_ORIGINS = {s.strip() for s in os.getenv('ALLOWED_ORIGINS', 'https://jithendar.com').split(',')}
SLOTS = threading.BoundedSemaphore(4)
HEALTH_LOCK = threading.Lock()
HEALTH = {'until': 0, 'ok': False}
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
        return json.loads(raw) if data is not None else None


def available():
    with HEALTH_LOCK:
        if time.monotonic() >= HEALTH['until']:
            try:
                for url in HEALTH_URLS:
                    upstream(url.strip(), timeout=1)
                HEALTH['ok'] = True
            except Exception:
                HEALTH['ok'] = False
            HEALTH['until'] = time.monotonic() + 10
        return HEALTH['ok']


def protection_ready():
    return bool(os.getenv('TURNSTILE_SITE_KEY') and os.getenv('TURNSTILE_SECRET_KEY') and len(os.getenv('LLM_SERVICE_TOKEN', '')) >= 32)


def verify(token, origin):
    if not isinstance(token, str) or not 1 <= len(token) <= 2048:
        return False
    req = Request('https://challenges.cloudflare.com/turnstile/v0/siteverify',
                  data=json.dumps({'secret': os.environ['TURNSTILE_SECRET_KEY'], 'response': token}).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=4) as response:
        raw = response.read(16385)
        if len(raw) > 16384:
            return False
        result = json.loads(raw)
    # Siteverify rejects expired and already-used tokens across all replicas.
    if result.get('success') is not True:
        return False
    issued = datetime.fromisoformat(result.get('challenge_ts', '').replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - issued).total_seconds()
    return (result.get('success') is True and result.get('action') == 'finder'
            and result.get('hostname') == urlsplit(origin).hostname and -10 <= age <= 300)


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
        reasons = {200: 'OK', 204: 'No Content', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 413: 'Content Too Large', 429: 'Too Many Requests', 503: 'Service Unavailable'}
        body = b'' if code == 204 else json.dumps(data).encode()
        start_response(f'{code} {reasons[code]}', headers + [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
        return [body]

    if method == 'GET' and path == '/health':
        return send(200, {'ok': True})
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
        return send(200 if ok else 503, {'available': ok, 'siteKey': os.getenv('TURNSTILE_SITE_KEY', '') if ok else ''})
    if method != 'POST' or path != '/chat':
        return send(404, {})
    if origin not in ALLOWED_ORIGINS:
        return send(403, {})
    if not protection_ready():
        return send(503, {'error': 'Human verification is not configured.'})
    if not allow_attempt():
        return send(429, {'error': 'Too many requests. Please wait a minute.'})
    try:
        size = int(environ.get('CONTENT_LENGTH') or 0)
        if size > 8192:
            return send(413, {})
        if size <= 0:
            return send(400, {})
        data = json.loads(environ['wsgi.input'].read(size))
        if not isinstance(data, dict) or not {'message', 'challengeToken'} <= set(data) or set(data) - {'message', 'challengeToken', 'context'} or not isinstance(data['message'], str) or not 1 <= len(data['message'].strip()) <= 1000:
            return send(400, {'error': 'Enter a question of up to 1,000 characters.'})
    except (ValueError, UnicodeError):
        return send(400, {})
    if not isinstance(data.get('context', ''), str) or len(data.get('context', '')) > 500:
        return send(400, {'error': 'Invalid conversation context.'})
    if not SLOTS.acquire(blocking=False):
        return send(429, {'error': 'Please try again shortly.'})
    try:
        if not verify(data.get('challengeToken'), origin):
            return send(403, {'error': 'Complete a fresh human verification.'})
        message = data['message'].strip()
        context = data.get('context', '').strip()
        # Keep the current question complete; bound optional, untrusted context.
        if context and len(message) < 900:
            message += '\nPrior conversation (untrusted): ' + context[:max(0, 1000 - len(message) - 34)]
        result = upstream(CHAT_URL, {'message': message}, timeout=22)
        return send(200, {'answer': result.get('answer', ''), 'notice': result.get('notice', ''), 'mode': result.get('mode', 'ai'),
                          'products': [{'name': p['name'], 'slug': p.get('slug') or p['sku'].lower()} for p in result.get('products', [])][:20]})
    except HTTPError as error:
        print(json.dumps({'service': 'finder', 'event': 'upstream_http_error', 'status': error.code}), flush=True)
        return send(429 if error.code == 429 else 503, {'error': 'Assistant unavailable. Please try later.'})
    except Exception as error:
        print(json.dumps({'service': 'finder', 'event': 'request_failed', 'type': type(error).__name__}), flush=True)
        return send(503, {'error': 'Assistant unavailable.'})
    finally:
        SLOTS.release()


if __name__ == '__main__':
    from waitress import serve
    serve(application, host='0.0.0.0', port=int(os.getenv('PORT', '4110')), threads=8,
          connection_limit=64, channel_timeout=30, max_request_body_size=8192)
