"""Private Redis-backed cart repository. The gateway owns pricing and authorization."""
import hmac
import json
import os
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from runtime import HttpError, serve, configure_telemetry, log_event
import redis

TTL = 7 * 86400
# Atomic replace and idempotent payment clearing; failed retries cannot clear a newer cart.
REPLACE = '''
local old = redis.call('GET', KEYS[1])
if not old then return -1 end
local cart = cjson.decode(old)
if cart.revision ~= tonumber(ARGV[1]) then return -2 end
cart.items = cjson.decode(ARGV[2]); cart.revision = cart.revision + 1
redis.call('SET', KEYS[1], cjson.encode(cart), 'EX', ARGV[3])
return cart.revision
'''
CLEAR = '''
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local old = redis.call('GET', KEYS[1])
if old then local cart = cjson.decode(old)
if tonumber(ARGV[2]) >= 0 and cart.revision ~= tonumber(ARGV[2]) then return -2 end
if ARGV[3] == '1' and next(cart.items) ~= nil then return -2 end
cart.items = cjson.decode('{}'); cart.revision = cart.revision + 1
redis.call('SET', KEYS[1], cjson.encode(cart), 'EX', ARGV[1]) end
redis.call('SET', KEYS[2], '1')
return 1
'''

def validate_items(items):
    if not isinstance(items, dict) or len(items) > 100 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', key) or type(value) is not int or not 1 <= value <= 20 for key, value in items.items()):
        raise HttpError(400, 'Invalid cart items.')
    return items

class CartService:
    def __init__(self, client, token):
        if len(token) < 32: raise RuntimeError('CART_SERVICE_TOKEN must contain at least 32 characters.')
        self.redis, self.token = client, token
    def handle(self, req):
        if req.path == '/ready' and req.method == 'GET':
            self.redis.ping(); return {'ok': True, 'service': 'cart-service'}
        if not hmac.compare_digest(req.headers.get('authorization', ''), 'Bearer ' + self.token):
            raise HttpError(401, 'Service authentication required.')
        match = re.fullmatch(r'/internal/carts/([a-f0-9-]{36})(/clear|/clear-checked)?', req.path)
        if not match: raise HttpError(404, 'Not found.')
        key = 'roboshop:cart:' + match[1]
        if req.method == 'POST' and match[2]:
            data=req.body()
            order = data.get('orderId', '')
            if not re.fullmatch(r'[a-f0-9-]{36}', order): raise HttpError(400, 'Invalid order ID.')
            revision,empty=-1,False
            if match[2]=='/clear-checked':
                revision=data.get('expectedRevision',-1);empty=data.get('requireEmpty',False)
                if type(revision) is not int or revision < -1 or type(empty) is not bool or (revision < 0 and not empty):
                    raise HttpError(400,'Expected checkout revision or an empty cart is required.')
            result=self.redis.eval(CLEAR, 2, key, 'roboshop:cart-cleared:' + order, TTL, revision, '1' if empty else '0')
            if result == -2: raise HttpError(409,'Cart revision differs from the paid checkout. Reconciliation required; cart preserved.')
            log_event('cart_cleared_after_payment', orderId=order, outcome='success', reason='already_applied' if result == 0 else 'cleared')
            return {'ok': True}
        if req.method == 'POST' and not match[2]:
            data = req.body(); items = validate_items(data.get('items'))
            if data.get('initialize') is True:
                self.redis.set(key, json.dumps({'items':items,'revision':0}), nx=True, ex=TTL)
            else:
                revision = data.get('revision')
                if type(revision) is not int or revision < 0: raise HttpError(400, 'Revision required.')
                result = self.redis.eval(REPLACE, 1, key, revision, json.dumps(items), TTL)
                if result < 0:
                    log_event('cart_update_rejected', 'WARN', revision=revision, reason='revision_conflict_or_expired', outcome='failure')
                    raise HttpError(409, 'Cart changed or expired. Refresh and retry.')
                log_event('cart_updated', revision=result, outcome='success', reason='items_persisted')
        elif req.method != 'GET' or match[2]: raise HttpError(405, 'Method not allowed.')
        raw = self.redis.get(key)
        if not raw: raise HttpError(404, 'Cart expired.')
        self.redis.expire(key, TTL)
        return json.loads(raw)

if __name__ == '__main__':
    configure_telemetry('cart-service')
    client = redis.Redis(host=os.getenv('REDIS_HOST','redis'),port=int(os.getenv('REDIS_PORT','6379')),password=os.environ['REDIS_PASSWORD'],decode_responses=True,socket_timeout=3,socket_connect_timeout=3)
    app = CartService(client, os.environ['CART_SERVICE_TOKEN'])
    serve('cart-service', 4107, app.handle)
