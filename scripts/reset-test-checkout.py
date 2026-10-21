#!/usr/bin/env python3
"""Retire one unused Razorpay test checkout during a brief gateway maintenance window."""
import argparse
import copy
import json
import subprocess
import uuid

REMOTE = r'''
import base64, datetime, http.client, json, os, pathlib, sys
provider_id = sys.argv[1]
p = pathlib.Path(os.environ.get('DATA_DIR', '/app/.data')) / 'store.json'
state = json.loads(p.read_text())
rows = [o for o in state['orders'] if o.get('razorpayOrderId') == provider_id]
if len(rows) != 1: raise SystemExit('Expected exactly one matching local order; no changes made.')
o = rows[0]
if o.get('paymentMode') != 'test' or o.get('status') != 'payment_pending' or o.get('paymentCaptured'):
    raise SystemExit('Only uncaptured, pending TEST orders can be reset.')
key = os.environ['RAZORPAY_KEY_ID']
if not key.startswith('rzp_test_'): raise SystemExit('Test API keys required; no changes made.')
credential = base64.b64encode((key+':'+os.environ['RAZORPAY_KEY_SECRET']).encode()).decode()
def fetch(path):
    c = http.client.HTTPSConnection('api.razorpay.com', timeout=10)
    try:
        c.request('GET', '/v1'+path, headers={'Authorization':'Basic '+credential})
        r = c.getresponse(); raw = r.read(1048577)
        if r.status != 200 or len(raw)>1048576: raise SystemExit('Razorpay verification failed; no changes made.')
        return json.loads(raw)
    finally: c.close()
order = fetch('/orders/'+provider_id)
payments = fetch('/orders/'+provider_id+'/payments')
if order.get('id') != provider_id or order.get('status') != 'created' or order.get('amount_paid', 0) != 0:
    raise SystemExit('Provider order is not unused; no changes made.')
if order.get('currency') != o.get('currency') or order.get('amount') != round(o['total']*100):
    raise SystemExit('Provider/local amount mismatch; no changes made.')
if order.get('attempts', 0) != 0 or payments.get('count') != 0 or payments.get('items') != []:
    raise SystemExit('Payment attempts exist. Reconcile them before resetting; no changes made.')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup = p.with_name('store.before-test-reset-'+stamp+'.json')
with open(backup, 'x', opener=lambda path,flags: os.open(path,flags,0o600)) as f:
    f.write(p.read_text()); f.flush(); os.fsync(f.fileno())
state.setdefault('retiredTestOrders', []).append({**o, 'status':'retired_test', 'retiredAt':stamp, 'reason':'Reprice checkout from current catalogue'})
state['orders'] = [row for row in state['orders'] if row['id'] != o['id']]
session = state['sessions'].get(o['session'])
if session: session.pop('shipping', None)
tmp = p.with_name('store.reset-'+stamp+'.tmp')
with open(tmp,'x',opener=lambda path,flags: os.open(path,flags,0o600)) as f:
    json.dump(state,f); f.flush(); os.fsync(f.fileno())
os.replace(tmp,p)
print('Retired unused test order '+provider_id+'. Cart and sold inventory preserved. Backup: '+backup.name)
'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('order', help='Razorpay order ID, e.g. order_...')
    parser.add_argument('--context', help='Explicit kubectl context; otherwise uses current context')
    args = parser.parse_args()
    if not args.order.startswith('order_') or not args.order[6:].isalnum(): parser.error('Invalid Razorpay order ID')
    base = ['kubectl'] + (['--context',args.context] if args.context else []) + ['-n','robotshop-ai']
    def run(*parts, data=None, capture=False):
        return subprocess.run(base+list(parts),input=data,text=True,check=True,capture_output=capture)
    deploy = json.loads(run('get','deployment','ai-gateway','-o','json',capture=True).stdout)
    replicas = deploy['spec'].get('replicas',1)
    if replicas != 1: raise SystemExit('Expected a single running gateway replica; no changes made.')
    podspec = deploy['spec']['template']['spec']
    source = next(c for c in podspec['containers'] if c['name']=='ai-gateway')
    helper = 'reset-test-checkout-'+uuid.uuid4().hex[:8]
    container = {k:copy.deepcopy(v) for k,v in source.items() if k in ('image','imagePullPolicy','env','envFrom','securityContext','volumeMounts','resources')}
    container.update(name='reset',command=['python','-c','import time; time.sleep(600)'])
    for key in ('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'):
        container.setdefault('env',[]).append({'name':key,'valueFrom':{'secretKeyRef':{'name':'robotshop-secrets','key':key}}})
    spec = {k:copy.deepcopy(v) for k,v in podspec.items() if k in ('securityContext','volumes','nodeSelector','tolerations','imagePullSecrets')}
    spec.update(containers=[container],restartPolicy='Never',automountServiceAccountToken=False,activeDeadlineSeconds=600)
    pod={'apiVersion':'v1','kind':'Pod','metadata':{'name':helper},'spec':spec}
    print('Pausing the gateway. Close all Razorpay checkout windows before continuing with this command.',flush=True)
    try:
        run('scale','deployment/ai-gateway','--replicas=0')
        run('wait','--for=delete','pod','-l','app=ai-gateway','--timeout=120s')
        run('create','-f','-',data=json.dumps(pod))
        run('wait','--for=condition=Ready','pod/'+helper,'--timeout=120s')
        run('exec','-i',helper,'--','python','-',args.order,data=REMOTE)
    finally:
        # Ensure the maintenance writer is gone before restoring the application.
        run('delete','pod',helper,'--ignore-not-found=true','--wait=true','--timeout=120s')
        run('scale','deployment/ai-gateway','--replicas='+str(replicas))
        run('rollout','status','deployment/ai-gateway','--timeout=180s')
    print('Gateway restored. Reload checkout and calculate shipping again before creating a new payment.')

if __name__ == '__main__': main()
