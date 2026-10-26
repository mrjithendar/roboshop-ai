#!/usr/bin/env python3
"""Opt-in isolated allow/deny/recovery test; never touches existing workloads."""
import argparse,datetime,json,subprocess,time,uuid
from pathlib import Path
from manage import context,confirm,kube
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
output=Path(a.output)
if output.exists():raise SystemExit('Refusing to overwrite evidence')
ctx=context();confirm('network-test')
ns='openclaw-netcheck-'+uuid.uuid4().hex[:8]
def apply(obj):subprocess.run(['kubectl','--context',ctx,'apply','-f','-'],input=json.dumps(obj),text=True,check=True,stdout=subprocess.DEVNULL)
def pod(name,command):return {'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':ns,'labels':{'app':name}},'spec':{'automountServiceAccountToken':False,'restartPolicy':'Never','securityContext':{'runAsNonRoot':True,'runAsUser':1000,'seccompProfile':{'type':'RuntimeDefault'}},'containers':[{'name':'test','image':'python:3.14.0-slim','command':command,'workingDir':'/tmp','securityContext':{'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}},'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'100m','memory':'64Mi'}}}]}}
try:
 apply({'apiVersion':'v1','kind':'Namespace','metadata':{'name':ns,'labels':{'pod-security.kubernetes.io/enforce':'restricted'}}})
 apply(pod('server',['python','-m','http.server','8080']))
 apply(pod('client',['python','-c','import time; time.sleep(600)']))
 kube('wait','-n',ns,'pod','--all','--for=condition=Ready','--timeout=90s')
 ip=kube('get','pod','server','-n',ns,'-o','jsonpath={.status.podIP}').strip()
 def connects():
  return subprocess.run(['kubectl','--context',ctx,'exec','-n',ns,'client','--','python','-c',f'import urllib.request; urllib.request.urlopen("http://{ip}:8080",timeout=2).read()'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10).returncode==0
 if not connects():raise RuntimeError('Positive control failed')
 apply({'apiVersion':'networking.k8s.io/v1','kind':'NetworkPolicy','metadata':{'name':'deny-server','namespace':ns},'spec':{'podSelector':{'matchLabels':{'app':'server'}},'policyTypes':['Ingress'],'ingress':[]}})
 denied=False
 for attempt in range(10):
  time.sleep(2)
  if not connects():
   denied=not connects() and not connects();break
 if not denied:raise RuntimeError('NetworkPolicy is NOT enforced; deployment must stay blocked')
 kube('delete','networkpolicy','deny-server','-n',ns)
 recovered=False
 for attempt in range(10):
  time.sleep(2)
  if connects():recovered=True;break
 if not recovered:raise RuntimeError('Recovery control failed; denial is inconclusive')
 data={'context':ctx,'allowedConnection':True,'deniedConnection':True,'recoveredConnection':True,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'testNamespace':ns}
 output.write_text(json.dumps(data,indent=2)+'\n');print('Network enforcement verified:',output)
finally:
 subprocess.run(['kubectl','--context',ctx,'delete','namespace',ns,'--wait=false'],check=False)
