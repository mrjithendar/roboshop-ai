"""Regression tests for the four reviewed commerce invariants; no external calls."""
import copy
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import test_checkout_concurrency as fixture
from store import Store
from runtime import HttpError
from provenance_backfill import repair, apply_repair
import mongomock

class CheckoutAliases(unittest.TestCase):
    setUp = fixture.CheckoutConcurrencyTests.setUp
    cart = fixture.CheckoutConcurrencyTests.cart

    def test_alias_paid_refill_restart_and_session_scope(self):
        a = self.gateway.checkout(self.alice, fixture.KEY)[0]['order']
        b = 'alternate-checkout-00001'
        with ThreadPoolExecutor(max_workers=4) as workers:
            rows = list(workers.map(lambda _: self.store.existing_payment(self.alice,b), range(8)))
        self.assertTrue(all(o['id']==a['id'] for o in rows))
        self.provider.captured=True
        self.gateway.reconcile(self.store.payment_order(a['id']))
        self.store.update(self.alice, 'ROBOT', 2, fixture.PRODUCTS)
        self.store.close()
        self.store=Store(self.tmp.name, self.repo)
        self.repo.store=self.store;self.gateway.store=self.store;self.provider.store=self.store
        again=self.gateway.checkout(self.alice,b)['order']
        self.assertEqual(again['id'],a['id'])
        self.assertEqual(self.provider.creates,1)
        self.assertIsNone(self.store.existing_payment(self.bob,b))
        self.assertEqual(self.store.cart(self.alice,fixture.PRODUCTS)['items'][0]['quantity'],2)

    def test_disabled_currency_and_malformed_quote_never_reserve(self):
        with patch.dict(os.environ, CHECKOUT_CURRENCIES='USD'):
            with self.assertRaises(HttpError):self.gateway.checkout(self.alice,fixture.KEY)
        for token in ('', 'malformed'):
            with self.assertRaises(HttpError):self.gateway.checkout(self.alice,fixture.KEY,token)
        self.assertEqual(self.store.orders(),[])
        self.assertEqual(self.store.reserved('ROBOT'),0)
        self.assertEqual(self.provider.creates,0)
        order=self.gateway.checkout(self.alice,fixture.KEY)[0]['order']
        with patch.dict(os.environ,CHECKOUT_CURRENCIES='USD'):
            self.assertEqual(self.gateway.checkout(self.alice,fixture.KEY)[0]['order']['currency'],'INR')
        self.assertEqual(self.provider.creates,1)

class Backfill(unittest.TestCase):
    def setUp(self):
        self.order=dict(paymentCaptured=True,synthetic=False,id='order-1',userId='u',status='paid',total=199,currency='INR',paymentMode='live',demo=False,inventoryProvenance='merchant',productProvenance=[dict(sku='R',demo=False,synthetic=False,fulfilment='merchant')],items=[dict(sku='R')])
        self.purchase={k:self.order[k] for k in ('userId','status','total','currency','paymentMode','paymentCaptured','synthetic')}
        self.purchase.update(_id='order-1',totalMinor=19900)
    def test_missing_only_identity_financial_match_and_repeat(self):
        fields,error=repair(self.order,self.purchase)
        self.assertIsNone(error);self.assertEqual(set(fields),{'demo','inventoryProvenance','productProvenance'})
        self.assertEqual(repair(self.order,{**self.purchase,**fields}),({},None))
        for key,value in [('userId','other'),('currency','USD'),('paymentMode','test'),('total',99),('demo',True)]:
            with self.subTest(key=key):
                fields,error=repair(self.order,{**self.purchase,key:value})
                self.assertEqual(fields,{});self.assertIsNotNone(error)
        bad=copy.deepcopy(self.order);bad.pop('inventoryProvenance')
        self.assertIsNotNone(repair(bad,self.purchase)[1])

    def test_repair_is_atomic_audited_and_refuses_concurrent_provenance(self):
        collection=mongomock.MongoClient().db.purchase_history
        collection.insert_one(self.purchase)
        updates,_=repair(self.order,self.purchase)
        self.assertEqual(apply_repair(collection,self.purchase,updates,'operator'),'repaired')
        row=collection.find_one()
        self.assertEqual(row['provenanceAudit'][0]['actor'],'operator')
        self.assertEqual(row['totalMinor'],19900)
        self.assertEqual(apply_repair(collection,self.purchase,updates,'operator'),'concurrent-conflict')
        self.assertEqual(len(collection.find_one()['provenanceAudit']),1)
