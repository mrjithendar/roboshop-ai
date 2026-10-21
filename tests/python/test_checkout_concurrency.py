"""Checkout interleavings use real threads, a durable ledger, and bounded fake I/O."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

import mongomock
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'services/ai-gateway'), str(ROOT / 'services/ai-gateway/lib')]
from server import Gateway
from store import Store, cents
from runtime import HttpError, Request, iso
from events import OrderPublisher
from purchase_sync import PurchaseSync

PRODUCTS = [dict(sku='ROBOT', price=199, currency='INR', instock=20, name='Robot')]
KEY = 'checkout-key-00000001'

class Repository:
    def __init__(self, store):
        self.store, self.rows, self.cleared = store, {}, set()
        self.entered, self.release = threading.Event(), threading.Event()
        self.slow = None
        self.lose_reply = False
    def initialize(self, id, items):
        assert not self.store.lock._is_owned()
        return copy.deepcopy(self.rows.setdefault(id, dict(items=items, revision=0)))
    def replace(self, id, items, revision):
        assert not self.store.lock._is_owned()
        if id == self.slow:
            self.entered.set()
            assert self.release.wait(5)
        if self.rows[id]['revision'] != revision:
            raise HttpError(409, 'Stale cart revision')
        self.rows[id] = dict(items=copy.deepcopy(items), revision=revision + 1)
        if self.lose_reply:
            self.lose_reply = False
            raise TimeoutError('Redis reply lost')
        return copy.deepcopy(self.rows[id])
    def clear_paid(self, id, order):
        assert not self.store.lock._is_owned()
        if order not in self.cleared:
            self.rows[id] = dict(items={}, revision=self.rows[id]['revision'] + 1)
            self.cleared.add(order)

class Provider:
    def __init__(self, store):
        self.store, self.orders, self.creates = store, {}, 0
        self.entered, self.release = threading.Event(), threading.Event()
        self.slow = False
        self.slow_path = None
        self.timeout = False
        self.captured = False
        self.last = None
    def __call__(self, path, data=None):
        assert not self.store.lock._is_owned(), path + ' ran under ledger lock'
        if path == self.slow_path:
            self.entered.set()
            assert self.release.wait(5)
        if path == 'config':
            return dict(enabled=True, mode='test', keyId='rzp_test_UNIT')
        if path == 'orders':
            self.creates += 1
            self.last = data['receipt']
            disk = json.loads(self.store.file.read_text())['orders'][-1]
            assert disk['id'] == data['receipt'] and disk['status'] == 'creating'
            assert disk['amount'] == cents(disk['total']) == data['amount'] and disk['paymentMode'] == data['mode']
            row = dict(orderId='order_UNIT', receipt=data['receipt'], amount=data['amount'], currency=data['currency'], keyId=data['keyId'], mode=data['mode'])
            self.orders[data['receipt']] = row
            self.entered.set()
            if self.slow:
                assert self.release.wait(5)
            if self.timeout:
                raise TimeoutError('Provider created order, HTTP response lost')
            return row
        if path == 'recover':
            row = self.orders.get(data['receipt'])
            return dict(found=bool(row), **(row or {}))
        if path == 'lookup':
            return next(row for row in self.orders.values() if row['orderId'] == data['orderId'])
        if path in ('verify', 'reconcile'):
            return dict(verified=self.captured, orderId=data['orderId'], amount=data['amount'], currency=data['currency'], paymentId='pay_UNIT')
        if path == 'webhook-check':
            return dict(ignored=False, orderId='order_UNIT', paymentId='pay_UNIT', mode='test', keyId='rzp_test_UNIT')
        raise AssertionError(path)

class CheckoutConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.store = Store(self.tmp.name); self.addCleanup(lambda: self.store.close())
        self.repo = Repository(self.store); self.store.cart_repository = self.repo
        self.env = patch.dict(os.environ, {'USER_SERVICE_TOKEN':'t'*64, 'APP_ENV':'test'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.gateway = Gateway(mongomock.MongoClient(tz_aware=True).db, self.store)
        self.gateway.catalogue = lambda: copy.deepcopy(PRODUCTS)
        self.provider = Provider(self.store); self.gateway.payment = self.provider
        self.gateway.auth.current = lambda token: {'id':'alice', 'role':'customer'} if token == 'a'*64 else {'id':'bob','role':'customer'}
        self.alice = self.cart('alice'); self.bob = self.cart('bob')
    def cart(self, user):
        with self.store.lock: id = self.store.session(None, user)
        self.store.sync_cart(id); self.store.update(id, 'ROBOT', 1, PRODUCTS)
        self.store.set_shipping(id, {'cost': 1, 'currency':'INR', 'quotedAt':iso()}, PRODUCTS)
        return id
    def req(self, path, method='POST', data=None, user='alice'):
        raw = json.dumps(data or {}).encode()
        token = ('a' if user == 'alice' else 'b') * 64
        return Request({'PATH_INFO':path, 'REQUEST_METHOD':method, 'CONTENT_TYPE':'application/json',
                        'CONTENT_LENGTH':str(len(raw)), 'wsgi.input':io.BytesIO(raw), 'REMOTE_ADDR':'127.0.0.1',
                        'HTTP_COOKIE':'rs_auth='+token, 'HTTP_IDEMPOTENCY_KEY':KEY})
    def test_slow_creation_allows_unrelated_cart_and_rejects_duplicates_and_edits(self):
        self.provider.slow = True
        with ThreadPoolExecutor(max_workers=3) as pool:
            creation = pool.submit(self.gateway.handle, self.req('/api/payments/orders'))
            try:
                self.assertTrue(self.provider.entered.wait(3))
                cart = pool.submit(self.gateway.handle, self.req('/api/cart', data={'sku':'ROBOT','quantity':2}, user='bob')).result(2)
                self.assertEqual(cart['items'][0]['quantity'], 2)
                with self.assertRaises(HttpError):
                    pool.submit(self.gateway.checkout, self.alice, KEY).result(2)
                with self.assertRaises(HttpError):
                    self.store.update(self.alice, 'ROBOT', 0, PRODUCTS)
                with self.assertRaises(HttpError):
                    self.store.set_shipping(self.alice, {}, PRODUCTS)
                self.assertEqual(self.provider.creates, 1)
                self.assertEqual(self.store.reserved('ROBOT'), 1)
            finally:
                self.provider.release.set()
            result = creation.result(3)[0]['order']
        again = self.gateway.checkout(self.alice, 'different-key-00000001')[0]['order']
        self.assertEqual(again['id'], result['id'])
        self.assertEqual((again['total'], again['currency'], self.provider.creates), (200, 'INR', 1))
        self.assertEqual(self.store.state['sessions'][self.bob]['items'], {'ROBOT':2})

    def test_cart_change_during_preparation_rejects_stale_snapshot(self):
        entered, release = threading.Event(), threading.Event()
        def catalogue():
            self.assertFalse(self.store.lock._is_owned()); entered.set()
            self.assertTrue(release.wait(5)); return PRODUCTS
        self.gateway.catalogue = catalogue
        with ThreadPoolExecutor(max_workers=1) as pool:
            creation = pool.submit(self.gateway.checkout, self.alice, KEY)
            try:
                self.assertTrue(entered.wait(2))
                self.store.update(self.alice, 'ROBOT', 2, PRODUCTS)
            finally: release.set()
            with self.assertRaisesRegex(HttpError, 'Cart changed'):
                creation.result(2)
        self.assertEqual(self.provider.creates, 0)
        self.assertEqual(self.store.state['orders'], [])

    def test_slow_redis_does_not_block_other_cart_and_lost_reply_recovers(self):
        self.repo.slow = self.alice
        with ThreadPoolExecutor(max_workers=2) as pool:
            write = pool.submit(self.store.update, self.alice, 'ROBOT', 2, PRODUCTS)
            try:
                self.assertTrue(self.repo.entered.wait(2))
                other = pool.submit(self.store.update, self.bob, 'ROBOT', 3, PRODUCTS).result(2)
                self.assertEqual(other['items'][0]['quantity'], 3)
            finally: self.repo.release.set()
            write.result(2)
        self.repo.slow = None; self.repo.lose_reply = True
        with self.assertRaises(TimeoutError): self.store.update(self.alice, 'ROBOT', 3, PRODUCTS)
        self.store.sync_cart(self.alice)
        self.assertEqual(self.store.cart(self.alice, PRODUCTS)['items'][0]['quantity'], 3)
        self.assertEqual(self.store.cart(self.bob, PRODUCTS)['items'][0]['quantity'], 3)

    def test_timeout_keeps_reservation_and_recovery_never_recreates(self):
        self.provider.timeout = True
        with self.assertRaises(TimeoutError): self.gateway.checkout(self.alice, KEY)
        order = copy.deepcopy(self.store.pending(self.alice))
        self.assertEqual(order['status'], 'payment_review')
        self.assertEqual(self.store.reserved('ROBOT'), 1)
        provider_order = self.provider.orders.pop(order['id'])
        with self.assertRaises(HttpError): self.gateway.checkout(self.alice, KEY)
        self.assertEqual(self.provider.creates, 1)
        self.assertEqual(self.store.pending(self.alice)['status'], 'payment_review')
        self.provider.orders[order['id']] = provider_order
        result = self.gateway.checkout(self.alice, KEY)[0]['order']
        self.assertEqual((result['id'], result['status']), (order['id'], 'payment_pending'))
        self.assertEqual(self.provider.creates, 1)

    def test_late_creation_callback_webhook_and_verify_are_idempotent(self):
        self.provider.slow = True
        with ThreadPoolExecutor(max_workers=2) as pool:
            creation = pool.submit(self.gateway.checkout, self.alice, KEY)
            try:
                self.assertTrue(self.provider.entered.wait(2))
                self.provider.captured = True
                # Provider webhook arrives before its create response is attached.
                self.gateway.handle(self.req('/api/payments/webhook'))
                order = self.store.state['orders'][0]
                self.assertEqual(order['status'], 'paid')
                event_id = order['shipmentEvent']['eventId']
                self.gateway.handle(self.req('/api/payments/webhook'))
            finally: self.provider.release.set()
            self.assertEqual(creation.result(2)['order']['status'], 'paid')
        result = self.gateway.handle(self.req('/api/payments/verify', data={'orderId':order['id'], 'razorpay_order_id':'order_UNIT', 'razorpay_payment_id':'pay_UNIT', 'razorpay_signature':'signed'}))
        self.assertEqual(result['status'], 'paid')
        self.assertEqual(self.store.state['testSold'], {'ROBOT':1})
        self.assertEqual(self.store.pending_events()[0]['eventId'], event_id)
        self.store.sync_cart(self.alice)
        self.store.update(self.alice, 'ROBOT', 2, PRODUCTS)
        self.gateway.handle(self.req('/api/payments/webhook'))
        self.store.sync_cart(self.alice)
        self.assertEqual(self.store.cart(self.alice, PRODUCTS)['items'][0]['quantity'], 2)

    def test_slow_reconciliation_does_not_block_unrelated_cart(self):
        order = self.gateway.checkout(self.alice, KEY)[0]['order']
        self.provider.entered.clear(); self.provider.slow_path = 'reconcile'
        self.provider.captured = True
        with ThreadPoolExecutor(max_workers=2) as pool:
            payment = pool.submit(self.gateway.reconcile, order)
            try:
                self.assertTrue(self.provider.entered.wait(2))
                other = pool.submit(self.gateway.handle, self.req('/api/cart', data={'sku':'ROBOT','quantity':2}, user='bob')).result(2)
                self.assertEqual(other['items'][0]['quantity'], 2)
            finally: self.provider.release.set()
            self.assertEqual(payment.result(2)['status'], 'paid')

    def test_restart_after_provider_creation_recovers_original_order_and_outbox(self):
        self.provider.timeout = True
        with self.assertRaises(TimeoutError): self.gateway.checkout(self.alice, KEY)
        original = copy.deepcopy(self.store.pending(self.alice))
        self.store.close()
        self.store = Store(self.tmp.name)
        self.gateway.store = self.store; self.provider.store = self.store
        self.provider.captured = True
        recovered = self.gateway.reconcile(original)
        self.assertEqual(recovered['id'], original['id'])
        self.assertEqual((recovered['total'], recovered['currency'], recovered['paymentMode']), (200, 'INR', 'test'))
        self.assertEqual(self.provider.creates, 1)
        event = self.store.pending_events()[0]
        self.store.close()
        self.store = Store(self.tmp.name)
        self.gateway.store = self.store; self.provider.store = self.store
        self.gateway.handle(self.req('/api/payments/webhook'))
        self.assertEqual(self.store.pending_events(), [event])
        self.assertEqual(self.store.state['testSold'], {'ROBOT':1})

    def test_stale_or_mismatched_provider_results_cannot_overwrite_state(self):
        order, _ = self.store.reserve_payment(self.alice, KEY, PRODUCTS, 'test', 'rzp_test_UNIT')
        row = dict(orderId='order_UNIT', amount=20000, currency='INR', keyId='rzp_test_UNIT', mode='test')
        with self.store.lock:
            self.store.review_payment(order['id'], 0)
            with self.assertRaises(HttpError): self.store.attach_payment(order['id'], row, 0)
            with self.assertRaises(HttpError): self.store.attach_payment(order['id'], row | {'currency':'USD'}, 1)
            with self.assertRaises(HttpError): self.store.attach_payment(order['id'], row | {'keyId':'other'}, 1)
            attached = self.store.attach_payment(order['id'], row, 1)
            captured = dict(verified=True, orderId='order_UNIT', amount=20000, currency='INR', paymentId='pay_UNIT')
            with self.assertRaises(HttpError): self.store.mark_paid(order['id'], captured, 0)
            with self.assertRaises(HttpError): self.store.mark_paid(order['id'], captured | {'amount':1}, attached['revision'])
            self.store.mark_paid(order['id'], captured, attached['revision'])
            with self.assertRaises(HttpError): self.store.mark_paid(order['id'], captured | {'paymentId':'pay_OTHER'})
        self.assertEqual(self.store.state['testSold'], {'ROBOT':1})

    def test_process_crash_recovery_and_exclusive_writer(self):
        env = dict(os.environ, PYTHONPATH=os.pathsep.join(sys.path))
        code = 'from store import Store; import sys; Store(sys.argv[1])'
        blocked = subprocess.run([sys.executable, '-c', code, self.tmp.name], env=env, capture_output=True, text=True)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn('already has a writer', blocked.stderr)
        # A child durably reserves then exits without cleanup or a provider response.
        self.store.close()
        code = "from store import Store; import os,sys,json; s=Store(sys.argv[1]); s.reserve_payment(sys.argv[2],sys.argv[3],json.loads(sys.argv[4]),'test','rzp_test_UNIT'); os._exit(0)"
        subprocess.run([sys.executable, '-c', code, self.tmp.name, self.alice, KEY, json.dumps(PRODUCTS)], env=env, check=True)
        self.store = Store(self.tmp.name); self.gateway.store = self.store
        self.provider.store = self.store
        self.assertEqual(self.store.pending(self.alice)['status'], 'payment_review')
        self.assertEqual(self.store.reserved('ROBOT'), 1)
        with self.assertRaises(HttpError): self.gateway.checkout(self.alice, KEY)
        self.assertEqual(self.provider.creates, 0)

    def test_event_and_purchase_projection_retries_keep_identity(self):
        self.provider.captured = True
        order = self.gateway.checkout(self.alice, KEY)[0]['order']
        paid = self.gateway.reconcile(order)
        event_id = self.store.pending_events()[0]['eventId']
        messages = []
        for failed in (True, False):
            publisher = OrderPublisher(self.store, 'amqp://test')
            channel, connection = Mock(), Mock()
            connection.channel.return_value = channel
            def publish(**kwargs):
                self.assertFalse(self.store.lock._is_owned())
                messages.append(json.loads(kwargs['body']))
                if failed: raise RuntimeError('Confirm lost')
            channel.basic_publish.side_effect = publish
            with patch('events.pika.BlockingConnection', return_value=connection), patch.object(publisher.stopped, 'wait', side_effect=lambda _: publisher.stopped.set()):
                publisher.run()
            self.assertEqual(bool(self.store.pending_events()), failed)
        self.assertEqual([m['eventId'] for m in messages], [event_id, event_id])
        client = Mock(); attempts = []
        def project(order):
            self.assertFalse(self.store.lock._is_owned()); attempts.append(order['id'])
            if len(attempts) == 1: raise TimeoutError('Projection reply lost')
            return True
        client.project.side_effect = project
        projection = PurchaseSync(client, self.store)
        with self.assertRaises(TimeoutError): projection.sync()
        projection.sync(); projection.sync()
        self.assertEqual(attempts, [paid['id'], paid['id']])
        self.assertTrue(self.store.payment_order(paid['id'])['customerSyncedAt'])

if __name__ == '__main__': unittest.main()
