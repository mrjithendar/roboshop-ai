import importlib.util
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
import redis
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'services/ai-gateway/lib'),str(ROOT/'services/ai-gateway')]
from runtime import HttpError
from store import Store
spec=importlib.util.spec_from_file_location('cart_service',ROOT/'services/cart-service/server.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

@unittest.skipUnless(shutil.which('redis-server'),'Local redis-server required')
class CartServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        cls.process=subprocess.Popen(['redis-server','--bind','127.0.0.1','--port',str(port),'--save','','--appendonly','no','--dir',cls.tmp.name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.redis=redis.Redis(host='127.0.0.1',port=port,decode_responses=True)
        for _ in range(100):
            try: cls.redis.ping();break
            except redis.ConnectionError:time.sleep(.02)
        cls.app=module.CartService(cls.redis,'t'*32)
    @classmethod
    def tearDownClass(cls):cls.redis.close();cls.process.terminate();cls.process.wait();cls.tmp.cleanup()
    def call(self,id,data=None,suffix='',token='t'*32):
        req=SimpleNamespace(path='/internal/carts/'+id+suffix,method='POST' if data is not None else 'GET',headers={'authorization':'Bearer '+token},body=lambda:data)
        return self.app.handle(req)
    def test_auth_validation_and_atomic_revision(self):
        id=str(uuid.uuid4())
        with self.assertRaises(HttpError):self.call(id,{'initialize':True,'items':{}},token='bad')
        self.assertEqual(self.call(id,{'initialize':True,'items':{}})['revision'],0)
        self.assertEqual(self.call(id,{'items':{'TEST':2},'revision':0})['revision'],1)
        with self.assertRaises(HttpError):self.call(id,{'items':{'TEST':3},'revision':0})
        self.assertEqual(self.call(id)['items'],{'TEST':2})
        for value in (True,-1,21,1.5):
            with self.assertRaises(HttpError):self.call(id,{'items':{'TEST':value},'revision':1})
    def test_payment_clear_does_not_remove_later_items(self):
        id=str(uuid.uuid4());order=str(uuid.uuid4())
        self.call(id,{'initialize':True,'items':{'TEST':1}})
        self.call(id,{'orderId':order},'/clear')
        cart=self.call(id);self.assertEqual(cart['items'],{})
        self.call(id,{'items':{'NEW':1},'revision':cart['revision']})
        self.call(id,{'orderId':order},'/clear')
        self.assertEqual(self.call(id)['items'],{'NEW':1})
    def test_store_migration_update_and_cache_recovery(self):
        outer=self
        class Repository:
            def initialize(self,id,items):return outer.call(id,{'initialize':True,'items':items})
            def replace(self,id,items,revision):return outer.call(id,{'items':items,'revision':revision})
            def clear_paid(self,id,order):return outer.call(id,{'orderId':order},'/clear')
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory,Repository());id=store.session(None);store.sync_cart(id)
            products=[dict(sku='TEST',price=12,instock=4,name='Robot')]
            store.update(id,'TEST',2,products)
            self.assertEqual(self.call(id)['items'],{'TEST':2})
            self.redis.delete('roboshop:cart:'+id)
            store.close()
            store=Store(directory,Repository());store.sync_cart(id)
            self.assertEqual(store.cart(id,products)['subtotal'],24)
            with self.assertRaises(HttpError):store.update(id,'TEST',5,products)
            with self.assertRaises(HttpError):store.update(id,'TEST',1,[{**products[0],'showcase':True}])

    def test_unavailable_cart_recovery_with_redis(self):
        outer = self
        class Repository:
            def initialize(self, id, items): return outer.call(id, {'initialize': True, 'items': items})
            def replace(self, id, items, revision): return outer.call(id, {'items': items, 'revision': revision})
        products = [dict(sku=sku, name=sku, price=12, currency='INR', instock=4) for sku in ('GONE', 'VALID')]
        for reason in ('archived', 'deleted', 'missing', 'showcase'):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                store = Store(directory, Repository())
                owner = store.session(None, 'alice'); store.sync_cart(owner)
                store.update(owner, 'GONE', 2, products)
                store.update(owner, 'VALID', 1, products)
                current = [products[1]] if reason in ('deleted', 'missing') else [{**products[0], reason: True}, products[1]]
                cart = store.cart(owner, current)
                self.assertEqual(cart['items'][0], {'sku': 'GONE', 'quantity': 2, 'unavailable': True})
                self.assertEqual((cart['subtotal'], cart['total'], cart['currency']), (12, 12, 'INR'))
                with self.assertRaisesRegex(HttpError, 'Remove unavailable'):
                    store.begin_payment(owner, 'a' * 20, current)
                self.assertEqual(store.state['orders'], [])
                with self.assertRaises(HttpError): store.update(owner, 'GONE', 3, current)
                with self.assertRaises(HttpError): store.update(owner, 'VALID', 5, current)
                with self.assertRaises(HttpError): store.update(owner, 'USD', 1, current + [dict(sku='USD', price=5, instock=4, currency='USD')])
                # Another user cannot acquire or remove the owner's item via session reuse.
                other = store.session(owner, 'bob'); store.sync_cart(other)
                store.update(other, 'GONE', 0, current)
                self.assertEqual(self.call(owner)['items'], {'GONE': 2, 'VALID': 1})
                # Reads and gateway restarts retain unavailable SKUs in Redis.
                store.close()
                store = Store(directory, Repository()); store.sync_cart(owner)
                self.assertTrue(next(item for item in store.cart(owner, current)['items'] if item['sku'] == 'GONE')['unavailable'])
                revision = self.call(owner)['revision']
                # A stale writer must not remove newer cart contents.
                self.call(owner, {'items': {'GONE': 2, 'VALID': 2}, 'revision': revision})
                with self.assertRaises(HttpError): store.update(owner, 'GONE', 0, current)
                store.sync_cart(owner)
                recovered = store.update(owner, 'GONE', 0, current)
                self.assertEqual(recovered['subtotal'], 24)
                self.assertEqual(self.call(owner)['items'], {'VALID': 2})
                self.assertEqual(self.call(owner)['revision'], revision + 2)
                store.close()
                store = Store(directory, Repository()); store.sync_cart(owner)
                self.assertEqual(store.cart(owner, current), recovered)
                from runtime import iso
                store.set_shipping(owner, {'cost': 3, 'currency': 'INR', 'quotedAt': iso()}, current)
                order = store.begin_payment(owner, 'b' * 20, current)
                self.assertEqual(order['total'], 27)
                with self.assertRaisesRegex(HttpError, 'payment is pending'):
                    store.update(owner, 'VALID', 0, [])
                self.assertEqual(self.call(owner)['items'], {'VALID': 2})

    def test_only_missing_items_have_no_payable_amount_or_shipping(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory); owner = store.session(None)
            product = dict(sku='TEST', price=12, instock=2, currency='USD')
            store.update(owner, 'TEST', 1, [product])
            store.set_shipping(owner, {'cost': 5, 'currency': 'USD'}, [product])
            cart = store.cart(owner, [])
            self.assertEqual((cart['subtotal'], cart['total'], cart['shipping']), (0, 0, None))
            self.assertEqual(store.update(owner, 'TEST', 0, [])['items'], [])

if __name__=='__main__':unittest.main()
