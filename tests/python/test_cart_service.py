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
            self.redis.delete('robotshop:cart:'+id)
            store=Store(directory,Repository());store.sync_cart(id)
            self.assertEqual(store.cart(id,products)['subtotal'],24)
            with self.assertRaises(HttpError):store.update(id,'TEST',5,products)
            with self.assertRaises(HttpError):store.update(id,'TEST',1,[{**products[0],'showcase':True}])

if __name__=='__main__':unittest.main()
