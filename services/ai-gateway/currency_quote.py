"""Signed merchant checkout quotes. All network I/O stays outside ledger locks."""
import base64
import copy
import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from runtime import HttpError, request

class QuoteError(HttpError):
    code = 'CHECKOUT_QUOTE_INVALID'

# This checkout ledger uses hundredths. Zero/three-decimal currencies need a
# separate minor-unit migration and cannot be enabled through configuration.
SUPPORTED = frozenset('INR USD EUR GBP SGD AUD CAD NZD CHF CNY HKD CZK DKK HUF PLN RON NOK SEK TRY BRL MXN ZAR MYR PHP THB IDR ILS'.split())


def currencies():
    selected = [x.strip().upper() for x in os.getenv('CHECKOUT_CURRENCIES', 'INR,USD,GBP,SGD,AUD').split(',') if x.strip()]
    if not selected or not set(selected) <= SUPPORTED:
        raise HttpError(503, 'Checkout currency configuration is invalid.')
    return list(dict.fromkeys(selected))


def secret():
    value = os.getenv('PAYMENT_SERVICE_TOKEN', '')
    if not value:
        raise HttpError(503, 'Checkout quote signing is not configured.')
    return value.encode()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def fingerprint(cart):
    snapshot = copy.deepcopy(cart)
    for item in snapshot['items']:
        item.pop('instock', None)  # Stock can change; the reservation validates it separately.
    return hashlib.sha256(canonical(snapshot)).hexdigest()


def sign(payload):
    raw = base64.urlsafe_b64encode(canonical(payload)).decode()
    return raw + '.' + hmac.new(secret(), raw.encode(), hashlib.sha256).hexdigest()


def decode(token):
    try:
        if not isinstance(token, str) or len(token) > 4096:
            raise ValueError()
        raw, signature = token.split('.')
        if not hmac.compare_digest(signature, hmac.new(secret(), raw.encode(), hashlib.sha256).hexdigest()):
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(raw))
        required = {'paymentMode', 'session', 'revision', 'fingerprint', 'sourceCurrency', 'currency', 'expiresAt', 'rate'}
        if not isinstance(payload, dict) or not required <= payload.keys():
            raise ValueError()
        if type(payload['revision']) is not int or type(payload['expiresAt']) is not int:
            raise ValueError()
        if any(not isinstance(payload[k], str) for k in ('paymentMode','session','fingerprint','sourceCurrency','currency','rate')):
            raise ValueError()
        rate = Decimal(payload['rate'])
        if not rate.is_finite() or rate <= 0:
            raise ValueError()
        return payload
    except (ValueError, TypeError, KeyError, ArithmeticError):
        raise QuoteError(400, 'Invalid checkout quote. Refresh your total.')


def convert(cart, payload):
    result = copy.deepcopy(cart)
    rate = Decimal(payload['rate'])
    def money(value):
        return float((Decimal(str(value)) * rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    target = payload['currency']
    subtotal = Decimal(0)
    for item in result['items']:
        item['price'] = money(item['price'])
        item['currency'] = target
        line = Decimal(str(item['price'])) * item['quantity']
        item['lineTotal'] = float(line)
        subtotal += line
    shipping = result.get('shipping')
    if shipping:
        shipping['cost'] = money(shipping['cost'])
        shipping['currency'] = target
    result.update(currency=target, subtotal=float(subtotal), total=float(subtotal + Decimal(str(shipping['cost'] if shipping else 0))))
    if not 0 < Decimal(str(result['total'])) * 100 <= 9007199254740991:
        raise HttpError(400, 'Converted checkout amount is outside supported limits.')
    return result


def issue(session, cart, revision, currency, payment_mode="test"):
    if payment_mode not in ("test", "live"):
        raise HttpError(503, "Payment mode unavailable.")
    if currency not in currencies():
        raise QuoteError(400, 'This currency is not enabled for checkout. Choose an available payment currency.')
    if not cart['items'] or any(item.get('unavailable') for item in cart['items']):
        raise HttpError(409, 'Remove unavailable items and add a purchasable product before requesting a quote.')
    origin = cart['currency']
    rate, as_of, source = Decimal(1), None, 'same-currency'
    if origin != currency:
        data = request(os.getenv('CURRENCY_URL', 'http://currency-service:4111') + '/rates', timeout=3)
        try:
            as_of = data['asOf']
            age = (datetime.now(timezone.utc).date() - date.fromisoformat(as_of)).days
            if not 0 <= age <= 7 or data.get('stale'):
                raise ValueError()
            left, right = Decimal(str(data['rates'][origin])), Decimal(str(data['rates'][currency]))
            if not all(v.is_finite() and Decimal('0.000001') <= v <= Decimal('1000000') for v in (left, right)):
                raise ValueError()
            rate = right / left
            source = 'ECB reference rate; merchant checkout quote'
        except (KeyError, ValueError, ArithmeticError, TypeError):
            raise HttpError(503, 'Currency quote unavailable. Please retry later or select the original currency.')
    payload = {'paymentMode': payment_mode, 'session': session, 'revision': revision, 'fingerprint': fingerprint(cart),
               'currency': currency, 'sourceCurrency': origin, 'rate': str(rate),
               'rateDate': as_of, 'source': source, 'expiresAt': int(time.time()) + 300}
    return {'cart': convert(cart, payload), 'quoteToken': sign(payload),
            'currency': currency, 'paymentMode': payment_mode, 'expiresAt': payload['expiresAt']}


def apply(cart, token, session, revision, payment_mode):
    """Called inside the existing atomic reservation, without network calls."""
    payload = decode(token)
    if (payload['paymentMode'] != payment_mode or payload['session'] != session or payload['revision'] != revision or
        payload['fingerprint'] != fingerprint(cart) or payload['sourceCurrency'] != cart['currency'] or
        payload['currency'] not in currencies() or payload['expiresAt'] <= time.time()):
        raise QuoteError(409, 'Checkout quote expired or your cart changed. Refresh your total before paying.')
    converted = convert(cart, payload)
    converted['currencyQuote'] = {k: v for k, v in payload.items() if k not in ('session', 'fingerprint')}
    converted['sourceCart'] = copy.deepcopy(cart)
    return converted
