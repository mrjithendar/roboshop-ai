"""Sandbox commerce regression tests; all provider operations are mocks."""
import copy
import json
import unittest
from unittest.mock import patch
import test_checkout_concurrency as fixture
from test_showcase import Customers
from runtime import HttpError, now
from product_details import require_purchasable
from store import Store
from server import public_order


class SandboxCheckoutTests(unittest.TestCase):
    setUp = fixture.CheckoutConcurrencyTests.setUp
    cart = fixture.CheckoutConcurrencyTests.cart
    req = fixture.CheckoutConcurrencyTests.req

    def test_demo_catalogue_live_rejection_is_before_reservation_or_provider_create(self):
        for flags in ({'demo':True}, {'catalogueVersion':'merchant-20-inr-v1'}, {'synthetic':True,'demo':True}, {'fulfilment':'simulated'}):
            self.gateway.catalogue = lambda: [fixture.PRODUCTS[0] | flags]
            original = self.provider
            self.gateway.payment = lambda path, data=None: dict(enabled=True,mode='live',keyId='rzp_live_UNIT') if path == 'config' else original(path,data)
            with self.assertRaises(HttpError):
                self.gateway.checkout(self.alice, fixture.KEY)
            self.assertEqual(self.provider.creates,0)
            self.assertEqual(self.store.state['orders'],[])
        for flags in ({'showcase':True},{'priceType':'reference'},{'synthetic':True}):
            with self.assertRaises(HttpError):
                require_purchasable(fixture.PRODUCTS[0] | flags)

    def test_paid_demo_preserves_provenance_stock_history_events_and_no_badge(self):
        products = [fixture.PRODUCTS[0] | {'demo':True,'fulfilment':'simulated','catalogueVersion':'demo-20-inr-v2'}]
        self.gateway.catalogue = lambda: copy.deepcopy(products)
        order = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        self.assertTrue(order['demo'])
        self.assertEqual(order['inventoryProvenance'],'demo')
        self.assertEqual(self.store.available(products[0],'live'),20)
        self.assertEqual(self.store.available(products[0],'test'),19)
        products[0]['demo'] = False  # Existing snapshot never follows later catalogue edits.
        self.provider.captured = True
        paid = self.gateway.reconcile(order)
        self.assertTrue(paid['productProvenance'][0]['demo'])
        self.assertEqual(self.store.state['sold'],{})
        self.assertEqual(self.store.state['testSold'],{'ROBOT':1})
        event = self.store.pending_events()[0]
        self.assertEqual(event['type'],'order.test-paid')
        self.assertEqual(event['paymentMode'],'test')
        self.assertTrue(event['demo'])
        customers = Customers(self.gateway.db)
        customers.project(paid); customers.project(paid)
        history = self.gateway.db.purchase_history.find_one({'_id':paid['id']})
        self.assertEqual(history['productProvenance'],paid['productProvenance'])
        self.assertEqual(history['paymentMode'],'test')
        self.assertEqual(self.gateway.db.purchase_history.count_documents({}),1)
        self.assertFalse(customers.verified({'authorId':'alice','productId':'ROBOT','createdAt':now()}))
        self.assertEqual(customers.profile('alice')['purchaseSummary'],[])

    def test_live_merchant_order_has_separate_stock_real_event_and_badge(self):
        original = self.provider
        self.gateway.payment = lambda path, data=None: dict(enabled=True,mode='live',keyId='rzp_live_UNIT') if path == 'config' else original(path,data)
        order = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        self.assertFalse(order['demo'])
        self.assertEqual(self.store.available(fixture.PRODUCTS[0],'test'),20)
        self.assertEqual(self.store.available(fixture.PRODUCTS[0],'live'),19)
        self.provider.captured = True
        paid = self.gateway.reconcile(order)
        self.assertEqual(self.store.state['sold'],{'ROBOT':1})
        self.assertEqual(self.store.state['testSold'],{})
        self.assertEqual(self.store.pending_events()[0]['type'],'order.paid')
        customers = Customers(self.gateway.db)
        customers.project(paid)
        self.assertTrue(customers.verified({'authorId':'alice','productId':'ROBOT','createdAt':now()}))
        self.gateway.auth.current = lambda _: {'id':'operator','role':'superadmin'}
        with self.assertRaises(HttpError) as caught:
            self.gateway.handle(self.admin_request(f'/api/admin/test-orders/{paid["id"]}/reconcile',
                {'revision':paid['revision'],'reason':'This is not a sandbox order'}))
        self.assertEqual(caught.exception.status,409)

    def test_failed_dismissed_and_resumed_orders_hold_test_reservations(self):
        first = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        for _ in range(3):
            self.assertEqual(self.gateway.reconcile(first)['status'],'payment_pending')
            resumed = self.gateway.checkout(self.alice,'different-checkout-key')[0]
            self.assertEqual(resumed['order']['id'],first['id'])
            self.assertEqual(resumed['checkout']['key'],'rzp_test_UNIT')
        self.assertEqual(self.provider.creates,1)
        self.assertEqual(self.store.reserved('ROBOT','test'),1)
        self.assertEqual(self.store.reserved('ROBOT','live'),0)
        with self.assertRaises(HttpError):
            self.store.update(self.alice,'ROBOT',0,fixture.PRODUCTS)

    def test_lost_callback_webhook_retries_preserve_single_capture(self):
        order = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        self.provider.captured = True
        for _ in range(3):
            self.gateway.handle(self.req('/api/payments/webhook'))
        self.assertEqual(self.store.state['testSold'],{'ROBOT':1})
        self.assertEqual(len(self.store.pending_events()),1)
        self.assertEqual(self.store.payment_order(order['id'])['status'],'paid')
        with self.assertRaises(HttpError) as caught:
            self.store.payment_order(order['id'],self.bob)
        self.assertEqual(caught.exception.status,404)

    def admin_request(self, path, data=None, method='POST'):
        request = self.req(path,method,data)
        request.headers['origin'] = self.gateway.origin
        return request

    def test_operator_reconciliation_requires_superadmin_and_audits_without_release(self):
        self.provider.timeout = True
        with self.assertRaises(TimeoutError): self.gateway.checkout(self.alice,fixture.KEY)
        order = self.store.state['orders'][0]
        path = f'/api/admin/test-orders/{order["id"]}/reconcile'
        body = {'reason':'Browser closed after timeout', 'revision':order['revision']}
        with self.assertRaises(HttpError) as denied:
            self.gateway.handle(self.admin_request(path,body))
        self.assertEqual(denied.exception.status,403)
        self.gateway.auth.current = lambda _: {'id':'operator','role':'superadmin'}
        self.provider.orders.clear()  # A missing receipt is still ambiguous.
        result = self.gateway.handle(self.admin_request(path,body))
        self.assertEqual(result['status'],'payment_review')
        self.assertEqual([e['outcome'] for e in result['reconciliationAudit']],['requested','payment_review'])
        self.assertEqual(result['reconciliationAudit'][0]['actor'],'operator')
        self.assertEqual(self.store.reserved('ROBOT','test'),1)
        self.assertEqual(self.provider.creates,1)
        self.assertNotIn('reconciliationAudit',public_order(result))
        with patch.object(self.gateway,'reconcile',side_effect=HttpError(503,'Unavailable')):
            with self.assertRaises(HttpError): self.gateway.handle(self.admin_request(path,body))
        self.assertEqual(self.store.payment_order(order['id'])['reconciliationAudit'][-1]['outcome'],'unavailable')
        with self.assertRaises(HttpError):
            self.gateway.handle(self.admin_request(path,body | {'revision':999}))

    def test_original_mode_is_used_for_resume_after_configuration_change(self):
        first = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        original = self.provider
        seen = []
        def switched(path,data=None):
            seen.append((path,data))
            if path == 'config' and data is None:
                return {'enabled':True,'mode':'live','keyId':'rzp_live_UNIT'}
            return original(path,data)
        self.gateway.payment = switched
        resumed = self.gateway.checkout(self.alice,fixture.KEY)[0]
        self.assertEqual(resumed['order']['paymentMode'],'test')
        self.assertTrue(resumed['order']['demo'])
        self.assertTrue(all(data['mode']=='test' for path,data in seen if path in ('reconcile','config')))
        self.assertEqual(resumed['checkout']['key'],'rzp_test_UNIT')

    def test_legacy_live_demo_order_cannot_offer_another_checkout(self):
        original = self.provider
        self.gateway.payment = lambda path, data=None: dict(enabled=True,mode='live',keyId='rzp_live_UNIT') if path == 'config' else original(path,data)
        self.gateway.checkout(self.alice,fixture.KEY)
        state = copy.deepcopy(self.store.state)
        state['orders'][0]['items'][0]['catalogueVersion'] = 'merchant-20-inr-v1'
        self.store.save(state)
        with self.assertRaises(HttpError) as caught:
            self.gateway.checkout(self.alice,fixture.KEY)
        self.assertIn('Demo inventory',str(caught.exception))
        self.assertEqual(self.store.reserved('ROBOT','live'),1)
        self.assertEqual(self.provider.creates,1)

    def test_legacy_paid_test_stock_migration_is_persistent_and_idempotent(self):
        order = self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        self.provider.captured = True
        self.gateway.reconcile(order)
        state = copy.deepcopy(self.store.state)
        state.pop('testSold')
        state['sold'] = {'ROBOT':3}  # One old test sale plus two live sales.
        self.store.save(state); self.store.close()
        for _ in range(2):
            reopened = Store(self.tmp.name)
            self.assertEqual(reopened.state['testSold'],{'ROBOT':1})
            self.assertEqual(reopened.state['sold'],{'ROBOT':2})
            reopened.close()
