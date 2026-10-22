"""Exercise the gateway against a real HTTP user-service boundary, with isolated Mongo mocks."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from wsgiref.simple_server import make_server, WSGIRequestHandler

import mongomock
ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT/'services/ai-gateway'), str(ROOT/'services/ai-gateway/lib')]
sys.path.append(str(ROOT/'services/user-service'))
from server import Gateway
from store import Store
from runtime import Request, HttpError, application, upstream
from user_client import UserClient
from purchase_sync import PurchaseSync
spec = importlib.util.spec_from_file_location('users_http_service', ROOT/'services/user-service/server.py')
users = importlib.util.module_from_spec(spec)
spec.loader.exec_module(users)

class Quiet(WSGIRequestHandler):
    def log_message(self, *args): pass

class UserServiceContract(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'USER_SERVICE_TOKEN':'u'*64, 'PUBLIC_ORIGIN':'https://shop.example', 'APP_ENV':'test', 'REGISTRATION_CHALLENGE_PROVIDER':'disabled'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.db = mongomock.MongoClient(tz_aware=True).db
        self.service = users.UserService(self.db)
        self.http = make_server('127.0.0.1', 0, application('user-service', self.service.handle), handler_class=Quiet)
        self.addCleanup(self.http.server_close)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.addCleanup(self.http.shutdown)
        self.url = f'http://127.0.0.1:{self.http.server_port}'
        urlenv = patch.dict(os.environ, {'USER_URL':self.url}); urlenv.start(); self.addCleanup(urlenv.stop)
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.gateway = Gateway(self.db, Store(self.directory.name))

    def req(self, path, method='GET', data=None, cookie='', origin='https://shop.example'):
        raw = json.dumps(data or {}).encode()
        return Request({'PATH_INFO':path,'REQUEST_METHOD':method,'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw),'REMOTE_ADDR':'192.0.2.7','HTTP_COOKIE':cookie,'HTTP_ORIGIN':origin,'HTTP_USER_AGENT':'Test Browser','HTTP_IDEMPOTENCY_KEY':'contract-checkout-0001'})

    def register(self):
        req=self.req('/api/auth/register','POST',{'name':'Alice','email':'alice@example.com','password':'correct password 123'})
        result=self.gateway.handle(req)
        cookie=next(value.split(';')[0] for _,value in req.cookies if value.startswith('rs_auth='))
        return result[0]['user'], cookie

    def test_cart_recovers_archived_product_and_rejects_checkout_before_provider(self):
        _, cookie = self.register()
        product = dict(sku='ROBOT', name='Robot', price=199, currency='INR', instock=5)
        self.gateway.catalogue = lambda: [product]
        self.gateway.handle(self.req('/api/cart', 'POST', {'sku': 'ROBOT', 'quantity': 1}, cookie=cookie))
        self.gateway.catalogue = lambda: []  # Active catalogue excludes archived/deleted rows.
        cart = self.gateway.handle(self.req('/api/cart', cookie=cookie))
        self.assertEqual(cart['items'], [{'sku': 'ROBOT', 'quantity': 1, 'unavailable': True}])
        self.assertEqual(cart['total'], 0)
        self.gateway.products = lambda: []
        recommendations = self.gateway.handle(self.req('/api/recommendations/personalized', cookie=cookie))
        self.assertEqual(recommendations['products'], [])
        with patch.object(self.gateway, 'payment') as payment:
            with self.assertRaisesRegex(HttpError, 'Remove unavailable'):
                self.gateway.handle(self.req('/api/payments/orders', 'POST', cookie=cookie))
            payment.assert_not_called()
        cart = self.gateway.handle(self.req('/api/cart', 'POST', {'sku': 'ROBOT', 'quantity': 0}, cookie=cookie))
        self.assertEqual(cart['items'], [])
        self.assertEqual(self.gateway.handle(self.req('/api/cart', cookie=cookie))['items'], [])

    def test_register_profile_login_and_logout_keep_public_contract(self):
        user,cookie=self.register()
        self.assertEqual(self.db.users.count_documents({}),1)
        self.assertNotIn('passwordHash',json.dumps(user))
        profile=self.gateway.handle(self.req('/api/account/profile',cookie=cookie))[0]
        self.assertEqual(profile['user']['id'],user['id'])
        self.assertEqual(profile['activity']['lastLoginIp'],'192.0.2.7')
        self.assertEqual(self.gateway.auth.current(cookie.split('=')[1])['id'],user['id'])
        self.gateway.handle(self.req('/api/auth/logout','POST',cookie=cookie))
        self.assertIsNone(self.gateway.auth.current(cookie.split('=')[1]))
        login=self.req('/api/auth/login','POST',{'email':'alice@example.com','password':'correct password 123'})
        self.assertEqual(self.gateway.handle(login)[0]['user']['id'],user['id'])
        self.assertTrue(any(c.startswith('rs_session=') for _,c in login.cookies))

    def test_service_rejects_direct_access_and_gateway_cannot_forge_identity(self):
        user,cookie=self.register()
        with self.assertRaises(HttpError) as denied:
            upstream(self.url+'/internal/session',{'token':cookie.split('=')[1]})
        self.assertEqual(denied.exception.status,401)
        with self.assertRaises(HttpError) as denied:
            self.gateway.handle(self.req('/api/admin/users',cookie=cookie))
        self.assertEqual(denied.exception.status,403)
        with self.assertRaises(HttpError) as denied:
            self.gateway.handle(self.req('/api/account/profile','PUT',{'name':'Mallory'},cookie=cookie,origin='https://evil.example'))
        self.assertEqual(denied.exception.status,403)
        with self.assertRaises(HttpError) as denied:
            self.gateway.handle(self.req('/api/account/profile'))
        self.assertEqual(denied.exception.status,401)

    def test_superadmin_role_change_revokes_customer_sessions(self):
        user,cookie=self.register()
        admin=self.service.auth.bootstrap('owner@example.com','superadmin password 123')
        token=self.service.auth.issue(self.db.users.find_one({'_id':admin['id']}))
        changed=self.gateway.handle(self.req('/api/admin/users/'+user['id'],'PATCH',{'role':'admin','disabled':False},cookie='rs_auth='+token))[0]
        self.assertEqual(changed['user']['role'],'admin')
        self.assertIsNone(self.gateway.auth.current(cookie.split('=')[1]))
        with self.assertRaises(HttpError):
            self.gateway.handle(self.req('/api/admin/users/'+admin['id'],'PATCH',{'role':'customer','disabled':False},cookie='rs_auth='+token))

    def test_paid_purchase_projection_is_idempotent_and_verification_is_scoped(self):
        user, cookie = self.register()
        order = {'id': 'order-one', 'userId': user['id'], 'status': 'paid',
                 'paymentCaptured': True, 'paymentMode': 'live', 'currency': 'INR',
                 'demo': False, 'synthetic': False, 'inventoryProvenance': 'merchant',
                 'productProvenance': [{'sku': 'robot-1', 'demo': False, 'synthetic': False, 'fulfilment': 'merchant'}],
                 'subtotal': 199, 'total': 199, 'shipping': None,
                 'paidAt': '2026-01-01T00:00:00Z', 'createdAt': '2026-01-01T00:00:00Z',
                 'items': [{'sku': 'robot-1', 'name': 'Robot', 'price': 199,
                            'quantity': 1, 'lineTotal': 199}], 'privateLedgerValue': 'omit'}
        self.assertTrue(self.gateway.auth.project(order))
        self.assertTrue(self.gateway.auth.project(order))
        self.assertEqual(self.db.purchase_history.count_documents({}), 1)
        self.assertNotIn('privateLedgerValue', self.db.purchase_history.find_one({}))
        review = {'authorId': user['id'], 'productId': 'robot-1',
                  'createdAt': '2026-01-02T00:00:00Z', 'synthetic': False}
        self.assertTrue(self.gateway.auth.verified_purchase(review))
        self.assertFalse(self.gateway.auth.verified_purchase({**review, 'authorId': 'another-user'}))
        self.assertFalse(self.gateway.auth.verified_purchase({**review, 'synthetic': True}))
        self.assertFalse(self.gateway.auth.verified_purchase({**review, 'createdAt': '2025-01-01T00:00:00Z'}))
        # Retries cannot rewrite money or immutable provenance.
        self.gateway.auth.project({**order, 'total': 999, 'demo': True})
        stored=self.db.purchase_history.find_one({'_id':order['id']})
        self.assertEqual(stored['total'],199)
        self.assertFalse(stored['demo'])
        for field in ('demo','synthetic','inventoryProvenance','productProvenance','paymentCaptured'):
            self.db.purchase_history.delete_many({})
            incomplete={k:v for k,v in order.items() if k != field}
            self.gateway.auth.project(incomplete)
            self.assertFalse(self.gateway.auth.verified_purchase(review),field)
        for changes in ({'paymentMode':'test'}, {'demo':True}, {'synthetic':True},
                        {'inventoryProvenance':'unknown'}, {'paymentCaptured':False},
                        {'productProvenance':[]}):
            self.db.purchase_history.delete_many({})
            self.gateway.auth.project({**order, **changes})
            self.assertFalse(self.gateway.auth.verified_purchase(review),changes)


    def test_fastapi_login_cookies_and_profile_http_contract(self):
        from asgi_app import create_app
        from fastapi.testclient import TestClient
        with TestClient(create_app(self.gateway),base_url='https://shop.example') as client:
            response=client.post('/api/auth/register',json={'name':'Alice','email':'alice@example.com','password':'correct password 123'},headers={'origin':'https://shop.example'})
            self.assertEqual(response.status_code,201)
            self.assertIn('rs_auth',client.cookies)
            self.assertIn('rs_session',client.cookies)
            self.assertEqual(client.get('/api/account/profile').status_code,200)
            self.assertEqual(client.post('/api/auth/logout',json={},headers={'origin':'https://evil.example'}).status_code,403)

    def test_user_service_failure_is_not_anonymous_authentication_fallback(self):
        _,cookie=self.register()
        with patch('user_client.upstream', side_effect=HttpError(503,'unavailable')):
            with self.assertRaises(HttpError) as err:
                self.gateway.auth.current(cookie.split('=')[1])
            self.assertEqual(err.exception.status,503)
            self.assertIsNone(self.gateway.auth.current(None))

if __name__ == '__main__': unittest.main()
