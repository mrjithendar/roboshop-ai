import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('reset_checkout',Path(__file__).resolve().parents[1]/'scripts/reset-test-checkout.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ResetTests(unittest.TestCase):
    def check(self,mode='test',attempts=0,status='created',expected=True):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'store.json'
            order={'id':'local','razorpayOrderId':'order_TEST','paymentMode':mode,'status':'payment_pending','paymentCaptured':False,'session':'cart','currency':'USD','total':1558}
            original={'orders':[order],'sessions':{'cart':{'items':{'ROBOT':2},'shipping':{'currency':'USD'}}},'sold':{'ROBOT':3}}
            p.write_text(json.dumps(original))
            replies=[{'id':'order_TEST','status':status,'amount':155800,'currency':'USD','amount_paid':0,'attempts':attempts},{'count':0,'items':[]}]
            class Connection:
                def __init__(self,*a,**kw): pass
                def request(self,*a,**kw): pass
                def getresponse(self):
                    class Response:
                        status=200
                        def read(self,n):return json.dumps(replies.pop(0)).encode()
                    return Response()
                def close(self): pass
            with patch.dict(os.environ,{'DATA_DIR':directory,'RAZORPAY_KEY_ID':'rzp_test_example','RAZORPAY_KEY_SECRET':'test'}),patch('sys.argv',['reset','order_TEST']),patch('http.client.HTTPSConnection',Connection):
                if expected:exec(module.REMOTE,{})
                else:
                    with self.assertRaises(SystemExit):exec(module.REMOTE,{})
            after=json.loads(p.read_text())
            if expected:
                self.assertEqual(after['orders'],[])
                self.assertEqual(after['retiredTestOrders'][0]['total'],1558)
                self.assertEqual(after['sold'],original['sold'])
                self.assertEqual(after['sessions']['cart']['items'],{'ROBOT':2})
                self.assertNotIn('shipping',after['sessions']['cart'])
                backups=list(Path(directory).glob('store.before-*.json'))
                self.assertEqual(json.loads(backups[0].read_text()),original)
            else:self.assertEqual(after,original)
    def test_unused_test_order(self):self.check()
    def test_live_order_rejected(self):self.check(mode='live',expected=False)
    def test_payment_attempt_rejected(self):self.check(attempts=1,expected=False)
    def test_paid_order_rejected(self):self.check(status='paid',expected=False)

if __name__=='__main__':unittest.main()
