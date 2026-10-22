"""Authenticated user-service client; no local authentication fallback."""
import os
from runtime import HttpError, upstream
from client_address import client_address


class UserClient:
    def __init__(self):
        self.url = os.getenv('USER_URL', 'http://127.0.0.1:4109').rstrip('/')
        self.token = os.getenv('USER_SERVICE_TOKEN', '')
        if len(self.token) < 32:
            raise RuntimeError('Configure USER_SERVICE_TOKEN with at least 32 characters.')

    def call(self, path, data, timeout=15):
        return upstream(self.url + '/internal/' + path, data, {'x-user-service-token': self.token}, timeout=timeout)

    def current(self, token):
        if not token:
            return None
        return self.call('session', {'token': token}, timeout=5)['user']

    def limit(self, key):
        self.call('limit', {'key': key}, timeout=5)

    def forward(self, req):
        result = self.call('request', {
            'path': req.path, 'method': req.method, 'query': req.query,
            'headers': {key: req.headers[key] for key in ('cookie', 'origin', 'sec-fetch-site', 'user-agent') if key in req.headers},
            'body': req.body() if req.method in ('POST', 'PUT', 'PATCH') else {},
            'clientAddress': client_address(req),
        }, timeout=25)
        for name, value in result.get('cookies', []):
            if name != 'Set-Cookie' or not value.startswith(('rs_auth=', 'rs_session=')) or '\r' in value or '\n' in value:
                raise HttpError(502, 'Invalid user-service response.')
            req.cookies.append((name, value))
        return result['body'], result['status'], []

    def save_address(self, user_id, shipping):
        self.call('address', {'userId': user_id, 'shipping': shipping}, timeout=5)

    def project(self, order):
        for key in ('demo', 'synthetic', 'paymentCaptured'):
            if key in order and type(order[key]) is not bool:
                raise ValueError('Invalid authoritative order provenance.')
        if order.get('inventoryProvenance', 'unknown') not in ('merchant', 'demo', 'unknown'):
            raise ValueError('Invalid authoritative inventory provenance.')
        if not isinstance(order.get('productProvenance', []), list):
            raise ValueError('Invalid authoritative product provenance.')
        provenance = order.get('productProvenance', [])
        if provenance:
            if any(not isinstance(p, dict) or not isinstance(p.get('sku'), str)
                   or any(type(p.get(k)) is not bool for k in ('demo', 'synthetic'))
                   or p.get('fulfilment') not in ('merchant', 'simulated', 'unknown') for p in provenance):
                raise ValueError('Invalid authoritative product provenance.')
            skus = [p['sku'] for p in provenance]
            if len(set(skus)) != len(skus) or set(skus) != {p['sku'] for p in order['items']}:
                raise ValueError('Invalid authoritative product provenance.')
        snapshot = {k: order[k] for k in ('id', 'userId', 'status', 'demo', 'inventoryProvenance', 'productProvenance', 'synthetic', 'paymentCaptured', 'paymentMode', 'currency', 'subtotal', 'total', 'paidAt', 'createdAt', 'shipping', 'currencyQuote') if k in order}
        snapshot['items'] = [{k: item[k] for k in ('sku', 'name', 'price', 'quantity', 'lineTotal')} for item in order['items']]
        return self.call('purchase', {'order': snapshot})['saved']

    def verified_purchase(self, row):
        return self.call('verified-purchase', {k: row.get(k) for k in ('authorId', 'productId', 'createdAt', 'synthetic')}, timeout=5)['verified']
