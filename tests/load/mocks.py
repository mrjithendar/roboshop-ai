"""Ollama and Razorpay wire protocols plus fixture catalogue/shipping, local only."""
import hashlib, hmac, json, os, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
from pathlib import Path

class State:
 def __init__(self,fixture):
  self.fixture=fixture;self.lock=threading.Lock();self.orders={};self.calls=0
 def report(self):
  with self.lock:return {'orders':list(self.orders.values()),'providerAttempts':self.calls}

def handler(state):
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):self.dispatch()
  def do_POST(self):self.dispatch()
  def dispatch(self):
   path=urlsplit(self.path).path
   size=int(self.headers.get('Content-Length','0'))
   if size>131072:return self.send(413,{'error':'bounded test body'})
   try:body=json.loads(self.rfile.read(size)) if size else {}
   except ValueError:return self.send(400,{})
   if path in ('/health','/api/catalogue/ready'):return self.send(200,{'ready':True})
   if path=='/api/tags':return self.send(200,{'models':[{'name':'load-mock'}]})
   if path=='/api/products':return self.send(200,{'products':state.fixture['products']})
   if path.startswith('/api/catalogue/search/'):
    return self.send(200,[p for p in state.fixture['products'] if 'vacuum' in p['categories']])
   if path=='/api/shipping/quote':
    return self.send(200,{'cost':1,'currency':'INR','quotedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'address':{'recipient':'Synthetic user','line1':'Test street','postalCode':'000000','phone':'+910000000000'},'city':{'name':'Test','country':'IN'}})
   if path=='/report':return self.send(200,state.report())
   # Only provider traffic gets chaos, never readiness/fixture setup.
   if path=='/api/chat' or path.startswith('/v1/'):
    with state.lock:state.calls+=1;attempt=state.calls
    time.sleep(min(20,float(os.getenv('MOCK_LATENCY_MS','20'))/1000))
    every=int(os.getenv('MOCK_ERROR_EVERY','0'))
    if every and attempt%every==0:
     time.sleep(min(20,float(os.getenv('MOCK_TIMEOUT_MS','0'))/1000))
     return self.send(int(os.getenv('MOCK_STATUS','503')),{'error':'Synthetic provider failure'})
   if path=='/api/chat':
    try:
     evidence=json.loads(body['messages'][1]['content'])
     assert len(evidence['request'])<=1000
    except (KeyError,ValueError,AssertionError):return self.send(400,{'error':'Invalid prompt'})
    return self.send(200,{'done':True,'model':'load-mock','message':{'content':'Synthetic response grounded in the supplied catalogue.'},'prompt_eval_count':100,'eval_count':10})
   if path=='/v1/orders' and self.command=='POST':
    with state.lock:
     existing=next((o for o in state.orders.values() if o['receipt']==body['receipt']),None)
     if existing:return self.send(409,{'error':'Duplicate receipt'})
     oid='order_'+hashlib.sha256(body['receipt'].encode()).hexdigest()[:24]
     order={**body,'id':oid,'status':'created'};state.orders[oid]=order
    return self.send(200,order)
   if path=='/v1/orders':
    receipt=parse_qs(urlsplit(self.path).query).get('receipt',[''])[0]
    return self.send(200,{'items':[o for o in state.report()['orders'] if o['receipt']==receipt]})
   if path.startswith('/v1/orders/'):
    oid=path.split('/')[3];order=state.orders.get(oid)
    if not order:return self.send(404,{})
    if path.endswith('/payments'):return self.send(200,{'items':[self.payment(order)] if order['status']=='paid' else []})
    return self.send(200,order)
   if path.startswith('/v1/payments/'):
    pid=path.split('/')[-1];order=state.orders.get('order_'+pid.removeprefix('pay_'))
    if not order:return self.send(404,{})
    # Synthetic capture occurs only after the actual payment service has
    # validated the HMAC callback signature; no external settlement exists.
    with state.lock:order['status']='paid'
    return self.send(200,self.payment(order))
   return self.send(404,{})
  def payment(self,order):return {'id':order['id'].replace('order_','pay_',1),'order_id':order['id'],'amount':order['amount'],'currency':order['currency'],'status':'captured','captured':True,'amount_refunded':0}
  def send(self,status,body):
   raw=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers()
   try:self.wfile.write(raw)
   except (BrokenPipeError,ConnectionResetError):pass
 return Handler

if __name__=='__main__':
 state=State(json.loads(Path(os.environ['LOAD_FIXTURES']).read_text()))
 ThreadingHTTPServer(('127.0.0.1',int(os.environ['PORT'])),handler(state)).serve_forever()
