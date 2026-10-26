#!/usr/bin/env python3
"""ELK offline rendering and explicit, bounded lab preparation. Never syncs Argo."""
import argparse
import base64
import json
import secrets
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ('ingestPassword','viewerPassword','securityKey','objectsKey','reportingKey')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['render','preflight','credentials','dashboards'])
    parser.add_argument('--context', default='mk4')
    parser.add_argument('--apply', action='store_true', help='Required for credential creation/dashboard import; otherwise preview only')
    args = parser.parse_args()
    kube = ['kubectl','--context',args.context,'--request-timeout=20s']
    def run(command, data=None):
        return subprocess.check_output(command, input=data, text=True)
    def get(kind, namespace=None):
        return json.loads(run(kube+(['-n',namespace] if namespace else ['-A'])+['get',kind,'-o','json']))
    if args.action=='render':
        for layer in ('core','pipeline'):
            print(run(['kubectl','kustomize',str(ROOT/'observability/elk'/layer)]))
        return
    if args.action in ('credentials','dashboards') and not args.apply:
        print('Preview only: '+('create missing els namespace and els-credentials; preserve existing keys' if args.action=='credentials' else 'import six saved searches, data view and dashboard through authenticated HTTPS /elk'))
        return
    if args.action=='preflight':
        nodes=get('nodes')['items']
        def mib(value):
            for suffix,scale in [('Ki',1/1024),('Mi',1),('Gi',1024)]:
                if value.endswith(suffix):return float(value[:-len(suffix)])*scale
            return float(value)/(1024*1024)
        if not any(mib(n['status']['allocatable']['memory'])>=4096 for n in nodes):
            raise RuntimeError('No node has 4 GiB allocatable; Elasticsearch requests 3 GiB plus node overhead. Resize a node first.')
        pods=get('pods')['items']
        operators=[];collectors=[]
        for pod in pods:
            ns=pod['metadata']['namespace']
            for c in pod['spec'].get('containers',[]):
                image=c.get('image','').lower()
                if 'eck-operator' in image:operators.append(ns+'/'+pod['metadata']['name'])
                if ns!='els' and any(s in image for s in ('filebeat','fluent-bit','fluentd','promtail','vector')):
                    collectors.append(ns+'/'+pod['metadata']['name'])
        if collectors:raise RuntimeError('Possible duplicate collectors; review before enabling Filebeat: '+', '.join(collectors))
        if operators:print('Existing ECK found: '+', '.join(operators)+'. Reuse it; DO NOT sync elk-operator. Verify it watches els and supports pinned Stack version.')
        else:
            crds=get('crds')['items']
            if any('k8s.elastic.co' in c['metadata']['name'] for c in crds):
                raise RuntimeError('Elastic CRDs already exist without a visible operator. Resolve ownership before installing ECK.')
            print('No ECK operator found. Sync elk-operator first, then elk-core, then elk-pipeline.')
        for cm in get('configmaps')['items']:
            if cm['metadata']['namespace']!='els' and any('filelog:' in v for v in cm.get('data',{}).values()):
                raise RuntimeError('Existing OTel filelog receiver found; review overlapping collection first.')
        run(kube+['get','ingressclass','traefik','-o','name'])
        run(kube+['-n','jithendar','get','tlsstore','default','-o','name'])
        run(kube+['get','storageclass','standard','-o','name'])
        run(kube+['get','crd','certificates.cert-manager.io','-o','name'])
        print('Inventory checks passed, not capacity or deployment readiness. Review kubectl describe nodes, top nodes/pods, free disk, CNI, host sysctl and image architecture before sync.')
        return
    if args.action=='credentials':
        # No values in command arguments or logs; do not rotate credentials on repeat runs.
        namespace=run(kube+['get','namespace','els','--ignore-not-found','-o','name'])
        if not namespace.strip():
            run(kube+['create','namespace','els'])
        existing=run(kube+['-n','els','get','secret','els-credentials','--ignore-not-found','-o','json'])
        if existing.strip():
            data=json.loads(existing).get('data',{})
            if not all(k in data and len(base64.b64decode(data[k]))>=32 for k in KEYS):
                raise RuntimeError('Existing els-credentials is incomplete; preserve and repair it explicitly')
            print('Reusing existing els-credentials; no rotation.');return
        run(kube+['create','-f','-'],json.dumps({'apiVersion':'v1','kind':'Secret','metadata':{'name':'els-credentials','namespace':'els'},'type':'Opaque','stringData':{k:secrets.token_hex(32) for k in KEYS}}))
        print('Created els-credentials; no values logged.');return
    # Admin only for saved-object import; normal browsing uses elk_viewer.
    secret=json.loads(run(kube+['-n','els','get','secret','logs-es-elastic-user','-o','json']))
    password=base64.b64decode(secret['data']['elastic']).decode()
    boundary='elk-'+secrets.token_hex(12)
    data=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="roboshop.ndjson"\r\nContent-Type: application/ndjson\r\n\r\n'.encode()+(ROOT/'observability/elk/dashboards/roboshop.ndjson').read_bytes()+f'\r\n--{boundary}--\r\n'.encode())
    req=urllib.request.Request('https://jithendar.com/elk/api/saved_objects/_import?overwrite=true',data=data,headers={'Authorization':'Basic '+base64.b64encode(('elastic:'+password).encode()).decode(),'kbn-xsrf':'elk-setup','Content-Type':'multipart/form-data; boundary='+boundary})
    with urllib.request.urlopen(req,context=ssl.create_default_context(),timeout=30) as response:
        result=json.load(response)
    if not result.get('success'):raise RuntimeError('Saved-object import failed; inspect Kibana diagnostics')
    print('Imported RoboShop dashboard and saved searches.')


if __name__=='__main__':
    try:main()
    except Exception as error:
        # No request/response bodies, credential values or subprocess input in errors.
        print('ELK operation failed:', str(error) if isinstance(error,RuntimeError) else type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
