import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import mongomock
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'lib')]
import admin_console
from server import Gateway
from store import Store
from runtime import Request, HttpError

SUPER = {'id': 'root', 'email': 'root@example.com', 'role': 'superadmin'}
ADMIN = {'id': 'ops', 'email': 'ops@example.com', 'role': 'admin'}


def order(n, status='paid', mode='live', days_ago=0, recipient='Asha', total=100.0, user='u1'):
    when = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    return {'id': f'{n:08d}-0000-0000-0000-000000000000', 'status': status, 'paymentMode': mode, 'createdAt': when,
            'paidAt': when if status == 'paid' else None, 'currency': 'INR', 'subtotal': total - 10, 'total': total,
            'items': [{'sku': f'SKU{n}', 'name': 'Robot', 'quantity': 1, 'lineTotal': total - 10}],
            'shipping': {'address': {'recipient': recipient, 'line1': 'Street'}, 'city': {'name': 'Pune', 'country': 'IN'}, 'cost': 10},
            'userId': user, 'session': 'secret-session', 'key': 'secret-key', 'paymentId': f'pay_{n}'}


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'USER_SERVICE_TOKEN': 'u' * 64, 'LLM_SERVICE_TOKEN': 'l' * 64}); env.start(); self.addCleanup(env.stop)
        self.db = mongomock.MongoClient().db
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.store = Store(self.tmp.name); self.addCleanup(self.store.close)
        self.gateway = Gateway(self.db, self.store)
        self.user = SUPER
        self.gateway.auth.current = Mock(side_effect=lambda token: self.user)
        self.orders = [order(1), order(2, status='payment_review'), order(3, days_ago=10, recipient='Ravi', total=250.0, user='u2'),
                       order(4, mode='test'), order(5, days_ago=40)]
        self.store.orders = lambda mode=None: [o for o in self.orders if mode is None or o['paymentMode'] == mode]
        self.db.products.insert_many([
            {'_id': 'LOW', 'sku': 'LOW', 'name': 'Low', 'instock': 3, 'archived': False, 'categories': ['robot']},
            {'_id': 'OUT', 'sku': 'OUT', 'name': 'Out', 'instock': 0, 'archived': False, 'categories': ['robot']},
            {'_id': 'OLD', 'sku': 'OLD', 'name': 'Old', 'instock': 9, 'archived': True, 'categories': ['robot']},
        ])
        self.db.reviews.insert_many([{'status': 'pending'}, {'status': 'published'}])

    def req(self, path, method='GET', body=None):
        raw = json.dumps(body).encode() if body is not None else b''
        path, _, query = path.partition('?')
        return Request({'PATH_INFO': path, 'QUERY_STRING': query, 'REQUEST_METHOD': method, 'CONTENT_LENGTH': str(len(raw)),
                        'CONTENT_TYPE': 'application/json', 'wsgi.input': io.BytesIO(raw), 'HTTP_COOKIE': 'rs_auth=' + 'a' * 64,
                        'HTTP_ORIGIN': self.gateway.origin, 'REMOTE_ADDR': '127.0.0.1'})

    def test_overview_hides_orders_from_admins(self):
        self.user = ADMIN
        result = self.gateway.handle(self.req('/api/admin/overview'))
        self.assertNotIn('orders', result)
        self.assertEqual((result['catalogue']['lowStock'], result['catalogue']['outOfStock'], result['catalogue']['archived']), (1, 1, 1))
        self.assertEqual(result['reviews']['pending'], 1)

    def test_overview_revenue_and_attention_for_superadmin(self):
        orders = self.gateway.handle(self.req('/api/admin/overview'))['orders']
        self.assertEqual(orders['revenue']['INR'], {'day': 100.0, 'week': 100.0, 'month': 350.0})
        self.assertEqual(orders['needsAttention'], 1)
        self.assertEqual((orders['liveTotal'], orders['testTotal'], orders['customers']), (4, 1, 2))
        self.assertEqual(len(orders['daily']), 14)
        self.assertNotIn('session', json.dumps(orders['recent']))

    def test_orders_filter_search_and_paginate_without_secrets(self):
        page = self.gateway.handle(self.req('/api/admin/orders?status=paid&limit=2'))
        self.assertEqual((page['total'], len(page['orders'])), (3, 2))
        self.assertEqual(page['orders'][0]['id'], order(1)['id'])  # newest first
        self.assertEqual(self.gateway.handle(self.req('/api/admin/orders?q=ravi'))['orders'][0]['shipping']['recipient'], 'Ravi')
        self.assertEqual(self.gateway.handle(self.req('/api/admin/orders?mode=test'))['total'], 1)
        self.assertNotIn('secret', json.dumps(page))
        with self.assertRaises(HttpError): self.gateway.handle(self.req('/api/admin/orders?status=bogus'))

    def test_orders_and_audit_are_superadmin_only(self):
        self.user = ADMIN
        for path in ('/api/admin/orders', '/api/admin/audit'):
            with self.assertRaises(HttpError) as raised: self.gateway.handle(self.req(path))
            self.assertEqual(raised.exception.status, 403)

    def test_successful_and_denied_changes_are_audited_without_values_of_free_text(self):
        body = {'storeName': 'Shop', 'announcement': 'Private text', 'supportEmail': '', 'checkoutEnabled': False}
        self.gateway.handle(self.req('/api/admin/settings', 'PUT', body))
        self.user = ADMIN
        with self.assertRaises(HttpError): self.gateway.handle(self.req('/api/admin/settings', 'PUT', body))
        self.user = SUPER
        log = self.gateway.handle(self.req('/api/admin/audit'))
        self.assertEqual(log['total'], 2)
        denied, applied = log['entries']
        self.assertEqual((denied['outcome'], denied['status'], denied['actor']['role']), ('failure', 403, 'admin'))
        self.assertEqual((applied['action'], applied['outcome'], applied['values']), ('settings.update', 'success', {'checkoutEnabled': False}))
        self.assertEqual(applied['fields'], ['announcement', 'checkoutEnabled', 'storeName', 'supportEmail'])
        self.assertNotIn('Private text', json.dumps(log))
        self.assertEqual(self.gateway.handle(self.req('/api/admin/audit?outcome=failure'))['total'], 1)

    def test_sensitive_keys_never_recorded_and_reads_not_audited(self):
        req = Mock(method='PATCH', path='/api/admin/users/abc')
        admin_console.record(self.db, req, SUPER, 200, {'role': 'admin', 'password': 'x', 'apiToken': 'y', 'revision': 3})
        entry = self.db.admin_audit.find_one()
        self.assertEqual((entry['action'], entry['target'], entry['fields'], entry['values']), ('user.access', 'abc', ['role'], {'role': 'admin'}))
        self.gateway.handle(self.req('/api/admin/overview'))
        self.assertEqual(self.db.admin_audit.count_documents({}), 1)


if __name__ == '__main__':
    unittest.main()
