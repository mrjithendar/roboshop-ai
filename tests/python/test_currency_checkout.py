"""Local currency checkout: mocked FX/provider, durable JSON ledger."""
import copy
import os
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import test_checkout_concurrency as fixture
import currency_quote as fx
from runtime import HttpError
from store import Store


class CurrencyCheckout(unittest.TestCase):
    def setUp(self):
        fixture.CheckoutConcurrencyTests.setUp(self)
        products = [dict(fixture.PRODUCTS[0], currency='USD')]
        override = patch.object(fixture, 'PRODUCTS', products)
        override.start(); self.addCleanup(override.stop)
        for session in (self.alice, self.bob):
            self.store.set_shipping(session, {'cost':1,'currency':'USD','quotedAt':fixture.iso()}, products)
    cart = fixture.CheckoutConcurrencyTests.cart
    req = fixture.CheckoutConcurrencyTests.req

    def quote(self, target='INR'):
        cart = self.store.cart(self.alice, fixture.PRODUCTS)
        with patch.dict(os.environ, PAYMENT_SERVICE_TOKEN='unit-test-quote-key'), patch.object(fx, 'request', return_value={
            'asOf':datetime.now(timezone.utc).date().isoformat(), 'stale':False,
            'rates':{'INR':100,'USD':1,'GBP':0.8,'SGD':1.6,'AUD':1.8}}):
            return fx.issue(self.alice, cart, self.store.cart_version(self.alice), target)

    def test_converted_order_provider_resume_recovery_and_capture(self):
        for target in ['INR']:
            with self.subTest(target=target), patch.dict(os.environ, PAYMENT_SERVICE_TOKEN='unit-test-quote-key'):
                quote=self.quote(target)
                result=self.gateway.checkout(self.alice,fixture.KEY,quote['quoteToken'])[0]
                order=result['order']
                self.assertEqual(order['currency'],target)
                self.assertEqual(order['total'],quote['cart']['total'])
                self.assertEqual(result['checkout']['currency'],target)
                self.assertEqual(result['checkout']['amount'],round(quote['cart']['total']*100))
                self.assertEqual(order['sourceCart']['currency'],'USD')
                # Later rates/currency selections cannot rewrite an existing provider order.
                again=self.gateway.checkout(self.alice,fixture.KEY,'invalid-but-not-used-for-resume')[0]
                self.assertEqual(again['order']['amount'],order['amount'])
                self.assertEqual(self.provider.creates,1)
                self.provider.captured=True
                paid=self.gateway.reconcile(self.store.payment_order(order['id']))
                self.assertEqual(paid['status'],'paid')
                self.assertEqual(paid['currency'],target)
                self.assertEqual(self.store.pending_events()[0]['currency'],target)
            # Start fresh fixtures for each independent checkout.


    def test_invalid_stale_wrong_owner_or_changed_cart_quotes_never_reserve(self):
        with patch.dict(os.environ, PAYMENT_SERVICE_TOKEN='unit-test-quote-key'):
            token=self.quote()['quoteToken']
            with self.assertRaises(HttpError): self.gateway.checkout(self.alice,fixture.KEY,token+'bad')
            with self.assertRaises(HttpError): self.gateway.checkout(self.bob,fixture.KEY,token)
            with self.assertRaises(HttpError):fx.apply(self.store.cart(self.alice,fixture.PRODUCTS),token,self.alice,self.store.cart_version(self.alice),'live')
            payload=fx.decode(token);payload['expiresAt']=int(time.time())-1
            with self.assertRaises(HttpError): self.gateway.checkout(self.alice,fixture.KEY,fx.sign(payload))
            self.store.update(self.alice,'ROBOT',2,fixture.PRODUCTS)
            self.store.set_shipping(self.alice,{'cost':1,'currency':'USD','quotedAt':fixture.iso()},fixture.PRODUCTS)
            with self.assertRaises(HttpError): self.gateway.checkout(self.alice,fixture.KEY,token)
            self.assertEqual(self.provider.creates,0)
            self.assertEqual(self.store.orders(),[])

    def test_stale_rates_unsupported_currency_and_source_prices_preserved(self):
        cart=self.store.cart(self.alice,fixture.PRODUCTS);original=copy.deepcopy(cart)
        with patch.dict(os.environ, PAYMENT_SERVICE_TOKEN='unit-test-quote-key'):
            with self.assertRaises(HttpError):fx.issue(self.alice,cart,0,'JPY')
            with patch.object(fx,'request',return_value={'asOf':'2000-01-01','rates':{'INR':1,'USD':2},'stale':True}):
                with self.assertRaises(HttpError):fx.issue(self.alice,cart,0,'INR')
            self.quote()
        self.assertEqual(cart,original)
        self.assertEqual(self.store.cart(self.alice,fixture.PRODUCTS)['currency'],'USD')

    def test_round_per_unit_then_sum_and_persist_across_restart(self):
        with patch.dict(os.environ, PAYMENT_SERVICE_TOKEN='unit-test-quote-key'):
            quote=self.quote('INR')
            self.assertEqual(quote['cart']['items'][0]['price'],19900)
            self.assertEqual(quote['cart']['shipping']['cost'],100)
            order=self.gateway.checkout(self.alice,fixture.KEY,quote['quoteToken'])[0]['order']
            self.store.close();self.store=Store(self.tmp.name)
            saved=self.store.payment_order(order['id'])
            self.assertEqual((saved['amount'],saved['currency']),(2000000,'INR'))
            self.assertEqual(saved['currencyQuote'],order['currencyQuote'])

    def test_quote_route_uses_server_prices_and_network_outside_ledger_lock(self):
        def rates(*args,**kwargs):
            self.assertFalse(self.store.lock._is_owned())
            return {'asOf':datetime.now(timezone.utc).date().isoformat(),'stale':False,'rates':{'INR':100,'USD':1}}
        with patch.dict(os.environ,PAYMENT_SERVICE_TOKEN='unit-test-quote-key'),patch.object(fx,'request',side_effect=rates):
            quote=self.gateway.handle(self.req('/api/payments/quote',data={'currency':'INR'}))
            result=self.gateway.handle(self.req('/api/payments/orders',data={'quoteToken':quote['quoteToken']}))[0]
            self.assertEqual((result['checkout']['currency'],result['checkout']['amount']),('INR',2000000))
            with self.assertRaises(HttpError):self.gateway.handle(self.req('/api/payments/quote',data={'currency':'INR','amount':1}))

    def test_non_inr_quotes_and_unquoted_foreign_cart_are_rejected(self):
        with patch.dict(os.environ, CHECKOUT_CURRENCIES='USD,EUR,INR', PAYMENT_SERVICE_TOKEN='unit-test-quote-key'):
            self.assertEqual(fx.currencies(), ['INR'])
            for target in ('USD', 'EUR', 'GBP'):
                with self.assertRaises(HttpError): self.quote(target)
            with self.assertRaises(HttpError): self.gateway.checkout(self.alice, fixture.KEY)
            token = self.quote()['quoteToken']
            payload = fx.decode(token); payload['currency'] = 'USD'
            with self.assertRaises(HttpError): self.gateway.checkout(self.alice, fixture.KEY, fx.sign(payload))
            self.assertEqual(self.provider.creates, 0)

    def test_conversion_rounds_units_and_shipping_to_paise(self):
        cart = {'currency':'USD', 'items':[{'price':1.005, 'quantity':3}], 'shipping':{'cost':0.015}}
        result = fx.convert(cart, {'rate':'1', 'currency':'INR'})
        self.assertEqual(result['items'][0]['price'], 1.01)
        self.assertEqual(result['shipping']['cost'], 0.02)
        self.assertEqual(result['total'], 3.05)
