#!/usr/bin/env python3
"""ELK offline rendering and explicit, bounded lab preparation. Argo sync requires an explicit --apply."""
import argparse
import base64
import json
import secrets
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ('ingestPassword','viewerPassword','securityKey','objectsKey','reportingKey')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['render','preflight','credentials','dashboards','sync'])
    parser.add_argument('--context', default='mk4')
    parser.add_argument('--apply', action='store_true', help='Required for credentials, dashboards or sync; otherwise preview only')
    parser.add_argument('--app', choices=['elk-operator','elk-core','elk-pipeline'], help='Application for sync')
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    if args.action=='sync' and not args.app:parser.error('sync requires --app')
    if args.timeout<=0:parser.error('--timeout must be positive')
    kube = ['kubectl','--context',args.context,'--request-timeout=20s']
    def run(command, data=None):
        return subprocess.check_output(command, input=data, text=True)
    def get(kind, namespace=None):
        # -A belongs to get, not kubectl's global flags. Cluster-scoped kinds
        # must not receive an all-namespaces flag at all.
        scope = ['-n',namespace] if namespace else ([] if kind in ('nodes','crds') else ['-A'])
        return json.loads(run(kube+['get',kind,*scope,'-o','json']))
    if args.action=='sync':
        if not args.apply:
            print('Preview only: register and sync '+args.app+' through Kubernetes; no Argo CLI login needed.');return
        command=kube+['-n','argocd']
        existing=run(command+['get','application',args.app,'--ignore-not-found','-o','json'])
        if existing.strip():
            live=json.loads(existing)
            wanted='elastic-system' if args.app=='elk-operator' else 'elk'
            if live['spec']['destination']['namespace']!=wanted:
                raise RuntimeError('Existing Application uses another namespace; review migration before changing its destination')
            if live.get('operation'):
                raise RuntimeError('An Argo sync is already running; wait for it before retrying')
        # Stop before mutations when an earlier deployment stage is not ready.
        if args.app=='elk-core':
            operators=get('pods')['items']
            ready=any(any('eck-operator' in c.get('image','') for c in pod['spec'].get('containers',[]))
                      and any(c.get('type')=='Ready' and c.get('status')=='True' for c in pod.get('status',{}).get('conditions',[]))
                      for pod in operators)
            if not ready:
                raise RuntimeError('ECK operator is not Ready; sync elk-operator and wait for its pod first')
        if args.app=='elk-pipeline':
            es=json.loads(run(kube+['get','elasticsearch','logs','-n','elk','-o','json']))
            if es.get('status',{}).get('health') not in ('green','yellow'):
                raise RuntimeError('Elasticsearch is not ready; finish elk-core before syncing elk-pipeline')
            for name in ('logstash-server','filebeat-client'):
                cert=json.loads(run(kube+['get','certificate',name,'-n','elk','-o','json']))
                if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in cert.get('status',{}).get('conditions',[])):
                    raise RuntimeError(name+' certificate is not Ready; finish elk-core first')
        run(command+['apply','-f',str(ROOT/'argocd/project-elk.yaml')])
        run(command+['apply','-f',str(ROOT/'argocd'/f'{args.app}.yaml')])
        # API-triggered operations do not automatically inherit the Application's
        # sync options. In particular, omitting CreateNamespace breaks ECK setup.
        configured=json.loads(run(command+['get','application',args.app,'-o','json']))
        options=configured.get('spec',{}).get('syncPolicy',{}).get('syncOptions',[])
        if 'CreateNamespace=true' not in options or 'FailOnSharedResource=true' not in options:
            raise RuntimeError('Application lacks required namespace/ownership sync options')
        # Invalidate old Git render cache when a namespace change was just pushed.
        run(command+['annotate','application',args.app,'argocd.argoproj.io/refresh=hard','--overwrite'])
        # Refresh is asynchronous. Do not submit a sync against a cached old render.
        refresh_deadline=time.monotonic()+args.timeout
        while True:
            refreshed=json.loads(run(command+['get','application',args.app,'-o','json']))
            if 'argocd.argoproj.io/refresh' not in refreshed.get('metadata',{}).get('annotations',{}):
                status=refreshed.get('status',{})
                if any(c.get('type') in ('ComparisonError','InvalidSpecError') for c in status.get('conditions',[])):
                    raise RuntimeError('Argo cannot render '+args.app+'; inspect its Application conditions')
                if any(r.get('namespace')=='els' for r in status.get('resources',[])):
                    raise RuntimeError('Git still renders namespace els; push the elk namespace changes before syncing')
                break
            if time.monotonic()>=refresh_deadline:
                raise RuntimeError('Argo hard refresh timed out; no sync requested')
            time.sleep(3)
        marker='elk-setup-'+secrets.token_hex(8)
        run(command+['patch','application',args.app,'--type=merge','--patch-file=/dev/stdin'],
            json.dumps({'operation':{'initiatedBy':{'username':marker},'sync':{'prune':False,'syncOptions':options}}}))
        deadline=time.monotonic()+args.timeout
        while time.monotonic()<deadline:
            app=json.loads(run(command+['get','application',args.app,'-o','json']))
            state=app.get('status',{}).get('operationState',{})
            # Ignore stale success from an earlier sync; wait for this operation.
            if state.get('operation',{}).get('initiatedBy',{}).get('username')==marker:
                phase=state.get('phase')
                if phase in ('Failed','Error'):
                    raise RuntimeError(args.app+' sync failed; inspect Application status and events in Argo CD')
                if phase=='Succeeded' and not app.get('operation'):
                    print(args.app+' sync succeeded. Check workload readiness separately.');return
            time.sleep(3)
        raise RuntimeError(args.app+' sync wait timed out; the server-side operation may still be running')

    if args.action=='render':
        for layer in ('core','pipeline'):
            print(run(['kubectl','kustomize',str(ROOT/'observability/elk'/layer)]))
        return
    if args.action in ('credentials','dashboards') and not args.apply:
        print('Preview only: '+('create missing elk namespace and elk-credentials; preserve existing keys' if args.action=='credentials' else 'import six saved searches, data view and dashboard through authenticated HTTPS /elk'))
        return
    if args.action=='preflight':
        nodes=get('nodes')['items']
        def mib(value):
            for suffix,scale in [('Ki',1/1024),('Mi',1),('Gi',1024)]:
                if value.endswith(suffix):return float(value[:-len(suffix)])*scale
            return float(value)/(1024*1024)
        if not any(mib(n['status']['allocatable']['memory'])>=5120 for n in nodes):
            raise RuntimeError('No node has 5 GiB allocatable; Elasticsearch requests 4 GiB plus node overhead. Resize a node first.')
        pods=get('pods')['items']
        operators=[];collectors=[]
        for pod in pods:
            ns=pod['metadata']['namespace']
            for c in pod['spec'].get('containers',[]):
                image=c.get('image','').lower()
                if 'eck-operator' in image:operators.append(ns+'/'+pod['metadata']['name'])
                if ns!='elk' and any(s in image for s in ('filebeat','fluent-bit','fluentd','promtail','vector')):
                    collectors.append(ns+'/'+pod['metadata']['name'])
        if collectors:raise RuntimeError('Possible duplicate collectors; review before enabling Filebeat: '+', '.join(collectors))
        if operators:print('Existing ECK found: '+', '.join(operators)+'. Reuse it; DO NOT sync elk-operator. Verify it watches elk and supports pinned Stack version.')
        else:
            crds=get('crds')['items']
            if any('k8s.elastic.co' in c['metadata']['name'] for c in crds):
                raise RuntimeError('Elastic CRDs already exist without a visible operator. Resolve ownership before installing ECK.')
            print('No ECK operator found. Sync elk-operator first, then elk-core, then elk-pipeline.')
        for cm in get('configmaps')['items']:
            if cm['metadata']['namespace']!='elk' and any('filelog:' in v for v in cm.get('data',{}).values()):
                raise RuntimeError('Existing OTel filelog receiver found; review overlapping collection first.')
        run(kube+['get','ingressclass','traefik','-o','name'])
        run(kube+['-n','jithendar','get','tlsstore','default','-o','name'])
        run(kube+['get','storageclass','standard','-o','name'])
        run(kube+['get','crd','certificates.cert-manager.io','-o','name'])
        print('Inventory checks passed, not capacity or deployment readiness. Review kubectl describe nodes, top nodes/pods, free disk, CNI, host sysctl and image architecture before sync.')
        return
    if args.action=='credentials':
        # No values in command arguments or logs; do not rotate credentials on repeat runs.
        namespace=run(kube+['get','namespace','elk','--ignore-not-found','-o','name'])
        if not namespace.strip():
            run(kube+['create','namespace','elk'])
        existing=run(kube+['-n','elk','get','secret','elk-credentials','--ignore-not-found','-o','json'])
        if existing.strip():
            data=json.loads(existing).get('data',{})
            if not all(k in data and len(base64.b64decode(data[k]))>=32 for k in KEYS):
                raise RuntimeError('Existing elk-credentials is incomplete; preserve and repair it explicitly')
            print('Reusing existing elk-credentials; no rotation.');return
        run(kube+['create','-f','-'],json.dumps({'apiVersion':'v1','kind':'Secret','metadata':{'name':'elk-credentials','namespace':'elk'},'type':'Opaque','stringData':{k:secrets.token_hex(32) for k in KEYS}}))
        print('Created elk-credentials; no values logged.');return
    # Admin only for saved-object import; normal browsing uses elk_viewer.
    secret=json.loads(run(kube+['-n','elk','get','secret','logs-es-elastic-user','-o','json']))
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
