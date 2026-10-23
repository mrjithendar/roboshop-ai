#!/usr/bin/env python3
"""Disposable, loopback-only application lab. No existing deployment is modified."""
import argparse, platform, contextlib, hashlib, json, os, re, secrets, shutil, socket, subprocess, sys, threading, time, uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
ROOT=Path(__file__).resolve().parents[2]; HERE=Path(__file__).resolve().parent

def safe_run(value):
 if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}',value):raise ValueError('Use a bounded lowercase run ID')
 return value

def free_port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def fixtures(run,count):
 users=[{'id':str(uuid.uuid5(uuid.NAMESPACE_URL,run+':'+str(n))), 'session':secrets.token_hex(32),'sku':f'LOAD-{n:03d}'} for n in range(1,count+1)]
 products=[{'sku':u['sku'],'slug':u['sku'].lower(),'name':'Synthetic vacuum '+u['sku'],'description':'Synthetic vacuum for isolated load tests','categories':['vacuum'],'price':99,'currency':'INR','priceType':'sale','instock':10000,'demo':True,'synthetic':True,'fulfilment':'simulated','inventoryStatus':'simulated','collection':'merchant'} for u in users]
 products.append({**products[0],'sku':'LOAD-LIMITED','slug':'load-limited','instock':3})
 return {'synthetic':True,'runId':run,'providerMode':'mock','users':users,'products':products,'paymentSecret':secrets.token_hex(32)}

class RunExistsError(RuntimeError):
 """An explicit run ID must not overwrite an earlier or active run."""

@contextlib.contextmanager
def running(run,count):
 folder=HERE/'.runs'/safe_run(run)
 try:
  folder.mkdir(parents=True,exist_ok=False)
 except FileExistsError:
  raise RunExistsError(
   f'Run {run!r} already exists; existing results were preserved. '
   'Omit --run-id to generate a fresh ID, or choose a new one. '
   f'To remove a completed run explicitly: python tests/load/lab.py cleanup --run-id {run}'
  ) from None
 folder.chmod(0o700)
 print(f'Run ID: {run}\nResults directory: {folder}',flush=True)
 (folder/'active').write_text(str(os.getpid()))
 fixture=fixtures(run,count);ports={r:free_port() for r in ('gateway','user','moks','mock','payment','edge')}
 ports['edge']=int(os.getenv('LOAD_EDGE_PORT',ports['edge']))
 base=f"http://127.0.0.1:{ports['edge']}";fixture['baseUrl']=base
 path=folder/'fixtures.json';path.write_text(json.dumps(fixture));path.chmod(0o600)
 # Allow only a minimal environment: never inherit cloud, DB, SMTP, telemetry,
 # superadmin or production integration credentials from the caller's shell.
 env={k:os.environ[k] for k in ('PATH','SYSTEMROOT','LANG','TMPDIR') if k in os.environ}
 token=secrets.token_hex(32)
 env.update(LOAD_FIXTURES=str(path),HOST='127.0.0.1',PUBLIC_ORIGIN=base,UPSTREAM_ORIGIN=base,ALLOWED_ORIGINS=base,
  USER_SERVICE_TOKEN=token,LLM_SERVICE_TOKEN=token,PAYMENT_SERVICE_TOKEN=token, PAYMENT_MODE='test',CHECKOUT_CURRENCIES='INR',
  RAZORPAY_KEY_ID='rzp_test_LOAD',RAZORPAY_KEY_SECRET=fixture['paymentSecret'],RAZORPAY_WEBHOOK_SECRET=secrets.token_hex(32),
  USER_URL=f"http://127.0.0.1:{ports['user']}",AI_GATEWAY_URL=f"http://127.0.0.1:{ports['gateway']}",
  AGENT_URL=f"http://127.0.0.1:{ports['moks']}",PAYMENT_URL=f"http://127.0.0.1:{ports['payment']}",
  CATALOGUE_URL=f"http://127.0.0.1:{ports['mock']}",SHIPPING_URL=f"http://127.0.0.1:{ports['mock']}",
  LOAD_MOCK_URL=f"http://127.0.0.1:{ports['mock']}",AUTH_URL=f"http://127.0.0.1:{ports['gateway']}/api/auth/me",
  CHAT_URL=f"http://127.0.0.1:{ports['gateway']}/api/chat", HEALTH_URLS=f"http://127.0.0.1:{ports['mock']}/health",LOG_LEVEL='ERROR',PYTHONUNBUFFERED='1',OTEL_SDK_DISABLED='true')
 for key in ('MOCK_LATENCY_MS','MOCK_ERROR_EVERY','MOCK_TIMEOUT_MS','MOCK_STATUS'):
  if key in os.environ:env[key]=os.environ[key]
 children=[];logs=[]
 class Edge(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):self.forward()
  def do_POST(self):self.forward()
  def forward(self):
   if self.path=='/__load/identity':
    payload=json.dumps({'synthetic':True,'runId':run,'providerMode':'mock'}).encode();self.send_response(200);self.end_headers();self.wfile.write(payload);return
   widget=self.path.startswith('/moks/')
   target=f"http://127.0.0.1:{ports['moks' if widget else 'gateway']}"+(self.path[5:] if widget else self.path)
   data=self.rfile.read(min(int(self.headers.get('Content-Length','0')),65536)) if self.command=='POST' else None
   headers={k:v for k,v in self.headers.items() if k.lower() in ('cookie','origin','content-type','idempotency-key','traceparent','tracestate')}
   try:
    try:response=urlopen(Request(target,data=data,headers=headers,method=self.command),timeout=25)
    except HTTPError as e:response=e
    with response:
     raw=response.read(2**20);self.send_response(response.status)
     for k,v in response.headers.items():
      if k.lower() in ('set-cookie','content-type','x-request-id'):self.send_header(k,v)
     self.end_headers();self.wfile.write(raw)
   except (OSError,TimeoutError):
    self.send_response(502);self.end_headers()
 edge=ThreadingHTTPServer((os.getenv('LOAD_EDGE_BIND','127.0.0.1'),ports['edge']),Edge)
 edge_started=False
 try:
  for role in ('mock','user','payment','gateway','moks'):
   log=open(folder/(role+'.log'),'w');logs.append(log)
   command=['node',str(HERE/'payment.mjs')] if role=='payment' else [sys.executable,str(HERE/('mocks.py' if role=='mock' else 'service.py'))]+([] if role=='mock' else [role])
   proc=subprocess.Popen(command,cwd=ROOT,env={**env,'PORT':str(ports[role])},stdout=log,stderr=log);children.append(proc)
   deadline=time.monotonic()+25
   while time.monotonic()<deadline:
    if proc.poll() is not None:raise RuntimeError(f'{role} exited; inspect private run logs')
    try:
     with urlopen(f"http://127.0.0.1:{ports[role]}/health",timeout=1):break
    except OSError:time.sleep(.1)
   else:raise RuntimeError(role+' did not start')
  threading.Thread(target=edge.serve_forever,daemon=True).start();edge_started=True
  yield folder,fixture
  with urlopen(env['LOAD_MOCK_URL']+'/report',timeout=2) as response:(folder/'provider-report.json').write_bytes(response.read())
 finally:
  if edge_started:edge.shutdown()
  edge.server_close()
  for proc in reversed(children):
   if proc.poll() is None:proc.terminate()
  for proc in children:
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
  for log in logs:log.close()
  (folder/'active').unlink(missing_ok=True)

def verify(folder):
 fixture=json.loads((folder/'fixtures.json').read_text())
 state=json.loads((folder/'ledger'/'store.json').read_text()) if (folder/'ledger'/'store.json').exists() else {}
 orders=state.get('orders',[]);errors=[];pairs=set();used={}
 for order in orders:
  key=(order.get('session'),order.get('key'))
  if key in pairs:errors.append('duplicate logical checkout')
  pairs.add(key)
  if order.get('paymentMode')!='test' or not order.get('demo'):errors.append('invalid payment provenance')
  for item in order['items']:used[item['sku']]=used.get(item['sku'],0)+item['quantity']
 capacities={p['sku']:p['instock'] for p in fixture['products']}
 if any(q>capacities.get(s,0) for s,q in used.items()):errors.append('oversold inventory')
 report_path=folder/'provider-report.json'
 if report_path.exists():
  receipts=[o['receipt'] for o in json.loads(report_path.read_text())['orders']]
  if len(receipts)!=len(set(receipts)):errors.append('duplicate provider receipt')
 report={'runId':fixture['runId'],'logicalOrders':len(orders),'reservedOrSold':sum(used.values()),'errors':errors,'backend':'single-writer JSON; not a PostgreSQL capacity result'}
 (folder/'verification.json').write_text(json.dumps(report,indent=2))
 if errors:raise RuntimeError('Durable verification failed; see verification.json')
 return report

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['run','serve','verify','cleanup']);p.add_argument('--run-id',default='load-'+secrets.token_hex(5));p.add_argument('--scenario',default='browse');p.add_argument('--profile',default='smoke');p.add_argument('--seconds');p.add_argument('--vus',type=int,default=2);p.add_argument('--k6',default='k6');args=p.parse_args()
 folder=HERE/'.runs'/safe_run(args.run_id)
 if args.action in ('verify','cleanup'):
  f=json.loads((folder/'fixtures.json').read_text());assert not folder.is_symlink() and f['synthetic'] and f['runId']==args.run_id
  if args.action=='cleanup':
   if (folder/'active').exists():raise RuntimeError('Stop the lab before cleanup')
   shutil.rmtree(folder)
  else:print(json.dumps(verify(folder)))
  return
 if not 1<=args.vus<=100:raise ValueError('VUs must be 1–100')
 with running(args.run_id,max(50,args.vus)) as (folder,fixture):
  if args.action=='serve':
   print(f"Isolated lab: {fixture['baseUrl']}\nFixture file: {folder/'fixtures.json'}",flush=True)
   try:
    while True:time.sleep(1)
   except KeyboardInterrupt:pass
   return
  env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG','TMPDIR','RATE','PACE_SECONDS','WARMUP_SECONDS','MAX_UNEXPECTED_RATE','P95_MS','AI_P95_MS','MAX_REJECTIONS','MAX_DROPPED')}
  env.update(BASE_URL=fixture['baseUrl'],TARGET_ALLOWLIST=fixture['baseUrl'],FIXTURES=str(folder/'fixtures.json'),RUN_ID=args.run_id,SCENARIO=args.scenario,PROFILE=args.profile,VUS=str(args.vus),RESULT_DIR=str(folder))
  if args.seconds:env['DURATION']=args.seconds+'s'
  environment={'cpuCount':os.cpu_count(),'platform':platform.platform(),'python':sys.version.split()[0],'generatorCoLocated':True,'storage':'single-writer JSON','mongo':'mongomock','replicas':1,'providerMode':'mock','commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()}
  for key,path in [('cgroupMemoryLimit','/sys/fs/cgroup/memory.max'),('cgroupCpuLimit','/sys/fs/cgroup/cpu.max')]:
   if Path(path).exists():environment[key]=Path(path).read_text().strip()
  (folder/'environment.json').write_text(json.dumps(environment,indent=2))
  config=folder/'k6-config.json';config.write_text('{}')
  result=subprocess.run([args.k6,'run','--config',str(config),str(HERE/'load.js')],cwd=ROOT,env=env)
 print(json.dumps(verify(folder)))
 raise SystemExit(result.returncode)
if __name__=='__main__':
 try:main()
 except RunExistsError as error:
  print(f'ERROR: {error}',file=sys.stderr)
  raise SystemExit(2)
