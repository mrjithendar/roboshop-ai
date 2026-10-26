#!/usr/bin/env python3
"""Explicit-context OpenClaw lifecycle, with no destructive defaults."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[2]

def run(args, capture=False, **kw):
    return subprocess.run(args,check=True,text=True,capture_output=capture,**kw).stdout

def require(*names):
    for n in names:
        if not shutil.which(n): raise RuntimeError(f'Missing dependency: {n}')

def context():
    require('kubectl')
    expected=os.getenv('OPENCLAW_CONTEXT')
    if not expected: raise RuntimeError('Set OPENCLAW_CONTEXT to the explicitly verified current context (discovered: mk4).')
    current=run(['kubectl','config','current-context'],True).strip()
    if expected!=current: raise RuntimeError(f'Context mismatch: expected {expected}, current {current}; no context was changed.')
    return expected

def kube(*args,capture=True):return run(['kubectl','--context',context(),'--request-timeout=15s',*args],capture)
def get(kind, namespace=None):
    return json.loads(kube('get',kind,*(['-n',namespace] if namespace else ['-A']),'-o','json'))

def doctor():
    issues=[]
    ns=get('namespaces')
    print('Current context verified:',context())
    print('Namespaces:',', '.join(x['metadata']['name'] for x in ns['items']))
    ds=get('daemonsets','kube-system')
    images=[c['image'] for d in ds['items'] for c in d['spec']['template']['spec']['containers']]
    if any('kindest/kindnetd' in i for i in images) and not any(any(engine in i for engine in ('kube-network-policies','cilium','calico')) for i in images):
        print('NOTE: kindest/kindnetd detected without a recognized policy engine. Engine-name detection is advisory; allow/deny/recovery evidence determines enforcement.')
    issues.append('NetworkPolicy enforcement requires recorded allow/deny smoke evidence; a CNI name alone is not proof.')
    certs=get('certificates.cert-manager.io','jithendar')['items']
    ready=any(c['metadata']['name']=='jithendar-com' and any(s['type']=='Ready' and s['status']=='True' for s in c.get('status',{}).get('conditions',[])) for c in certs)
    if not ready:issues.append('Canonical jithendar/jithendar-com certificate is not Ready.')
    stores=get('tlsstores.traefik.io')['items']
    canonical=[s for s in stores if s['metadata']['name']=='default']
    if len(canonical)!=1 or canonical[0]['metadata']['namespace']!='jithendar' or canonical[0].get('spec',{}).get('defaultCertificate',{}).get('secretName')!='jithendar-com-tls':issues.append('Shared TLSStore does not match discovery.')
    print('StorageClasses:',kube('get','storageclasses','-o','name').strip())
    for item in issues:print('BLOCKER:',item)
    return issues

def validate():
    require('kubectl')
    for overlay in ('mk4','public'):
        rendered=run(['kubectl','kustomize',str(ROOT/'minikube/openclaw/overlays'/overlay)],True)
        import yaml
        docs=list(yaml.safe_load_all(rendered))
        if not docs:raise RuntimeError('Empty Kustomize output')
        print(f'{overlay}: rendered {len(docs)} resources')
    run([sys.executable,'-m','unittest','discover','-s',str(ROOT/'tests'),'-p','test_openclaw_manifests.py','-v'])
    if shutil.which('openclaw') or os.getenv('OPENCLAW_BIN'):
        run([sys.executable,str(ROOT/'scripts/openclaw/validate_config.py')])
    else:print('NOT VERIFIED: install pinned OpenClaw CLI to run exact upstream schema validation.')

def confirm(action):
    expected=f'{action} {context()}'
    if not sys.stdin.isatty():raise RuntimeError('Changing operations require an interactive operator confirmation; no --yes bypass.')
    if input(f'Type "{expected}" to confirm: ')!=expected:raise RuntimeError('Cancelled')

def deployment_gate():
    issues=doctor()
    # This file is operator-produced after the actual isolated allow/deny network test.
    evidence=os.getenv('OPENCLAW_NETWORK_EVIDENCE')
    if evidence:
        try:
            data=json.loads(Path(evidence).read_text())
            import datetime
            age=datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(data['checkedAt'])
            if data.get('context')==context() and data.get('allowedConnection') is True and data.get('deniedConnection') is True and data.get('recoveredConnection') is True and 0 <= age.total_seconds() < 86400:
                issues=[i for i in issues if not i.startswith('NetworkPolicy enforcement requires')]
                print('NetworkPolicy gate passed: fresh allow/deny/recovery evidence matches the current context.')
            else:
                issues.append('Network evidence must pass all controls, match the context, and be less than 24 hours old.')
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            issues.append(f'Cannot read valid network evidence from {evidence}. Run network_smoke.py after enabling policy enforcement; use its actual output path.')
    rendered=run(['kubectl','kustomize',str(ROOT/'minikube/openclaw/overlays/mk4')],True)
    if 'REPLACE_WITH_COMMIT_SHA' in rendered:issues.append('Publish the operations image and commit its immutable image reference.')
    if run(['git','status','--porcelain','--','minikube/openclaw','services/mcp-server/operations'],True,cwd=ROOT).strip():issues.append('Commit and publish reviewed OpenClaw source before GitOps bootstrap.')
    if issues:raise RuntimeError('\n'.join(issues))
    # Read Secret metadata/key names only. Never emit data.
    for name in ('openclaw-gateway-secrets','openclaw-operations-identities','openclaw-registry'):
        kube('get','secret',name,'-n','openclaw','-o','name')

def backup(args):
    require('age');context()
    if not args.output or not args.recipient:raise RuntimeError('backup requires --output NEW_FILE.age --recipient AGE_PUBLIC_RECIPIENT')
    dest=Path(args.output)
    if dest.exists():raise RuntimeError('Backup destination already exists')
    # The official command snapshots SQLite, verifies the archive, and never overwrites it.
    remote='/tmp/openclaw-backup-'+__import__('uuid').uuid4().hex+'.tar.gz'
    kube('exec','-n','openclaw','deployment/openclaw','--','node','openclaw.mjs','backup','create','--output',remote,'--verify','--no-include-workspace')
    success=False
    try:
        with dest.open('xb') as out:
            os.chmod(dest,0o600)
            source=subprocess.Popen(['kubectl','--context',context(),'exec','-n','openclaw','deployment/openclaw','--','cat',remote],stdout=subprocess.PIPE)
            enc=subprocess.run(['age','-r',args.recipient],stdin=source.stdout,stdout=out)
            source.stdout.close()
            if source.wait()!=0 or enc.returncode!=0:raise RuntimeError('Encrypted backup failed; retain the remote archive for recovery')
        success=True
        print('Encrypted backup created:',dest)
    finally:
        # A temporary backup only, never the state volume.
        if success:kube('exec','-n','openclaw','deployment/openclaw','--','rm','-f',remote)

def restore(args):
    require('age','openclaw')
    if not args.archive or not args.identity or not args.target:raise RuntimeError('restore requires --archive FILE.age --identity AGE_KEY_FILE --target NEW_LOCAL_DIRECTORY')
    target=Path(args.target).resolve()
    if target.exists():raise RuntimeError('Restore target must not exist; live state is never overwritten')
    with tempfile.TemporaryDirectory(prefix='openclaw-restore-') as tmp:
        archive=Path(tmp)/'archive.tar.gz'
        with archive.open('xb') as out:
            os.chmod(archive,0o600)
            subprocess.run(['age','-d','-i',args.identity,args.archive],stdout=out,check=True)
        run(['openclaw','backup','verify',str(archive)])
        run(['openclaw','backup','restore',str(archive),'--target',str(target)])
    print('Restored to isolated local directory. Follow docs/openclaw/README.md for approved new-PVC cutover.')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('command',choices=['doctor','validate','bootstrap','deploy','status','logs','test','backup','restore','rollback'])
    for name in ('output','recipient','archive','identity','target','revision'):p.add_argument('--'+name)
    args=p.parse_args()
    if args.command=='doctor':
        if doctor():return 2
    elif args.command=='validate':validate()
    elif args.command=='test':
        validate();run([sys.executable,'-m','pytest','-q',str(ROOT/'services/mcp-server/tests/operations'),str(ROOT/'tests/test_openclaw_scripts.py')])
    elif args.command=='status':
        namespace=kube('get','namespace','openclaw','--ignore-not-found','-o','name').strip()
        if namespace:print(kube('get','deploy,pod,pvc,svc,ingress','-n','openclaw'))
        else:print('OpenClaw namespace has not been created; initial setup is incomplete.')
        application=kube('get','application','openclaw','-n','argocd','--ignore-not-found').strip()
        print(application or 'OpenClaw Argo CD Application has not been created; bootstrap has not completed.')
    elif args.command=='logs':
        # Logs can contain untrusted data; pipe through the same redaction boundary.
        sys.path.insert(0,str(ROOT/'services/mcp-server'))
        from operations.policy import redact
        print(redact(kube('logs','-n','openclaw','deployment/openclaw-operations','--tail=100')))
    elif args.command=='bootstrap':
        deployment_gate();confirm('bootstrap')
        kube('apply','-f',str(ROOT/'minikube/openclaw/argocd/application.yaml'),capture=False)
    elif args.command=='deploy':
        deployment_gate();confirm('deploy')
        # Request an Argo operation; never apply its managed workload resources.
        import uuid,time
        request_id=uuid.uuid4().hex
        operation={'initiatedBy':{'username':'openclaw-management'},'info':[{'name':'openclaw-request','value':request_id}],'sync':{'prune':False}}
        current=json.loads(kube('get','application','openclaw','-n','argocd','-o','json'))
        if current.get('operation'):raise RuntimeError('An Argo operation is already active; do not overwrite it')
        patch=[{'op':'test','path':'/metadata/resourceVersion','value':current['metadata']['resourceVersion']},{'op':'add','path':'/operation','value':operation}]
        kube('patch','application','openclaw','-n','argocd','--type=json','-p',json.dumps(patch))
        end=time.monotonic()+300
        while time.monotonic()<end:
            app=json.loads(kube('get','application','openclaw','-n','argocd','-o','json'))
            status=app.get('status',{});state=status.get('operationState',{})
            ours=any(i.get('value')==request_id for i in state.get('operation',{}).get('info',[]))
            if ours and state.get('phase') in ('Failed','Error'):raise RuntimeError('Argo synchronization failed; inspect Application status')
            if ours and state.get('phase')=='Succeeded' and status.get('sync',{}).get('status')=='Synced' and status.get('health',{}).get('status')=='Healthy':
                print('Argo reports Synced / Healthy for this sync request');break
            time.sleep(5)
        else:raise RuntimeError('Timed out awaiting this Argo sync operation')
    elif args.command=='rollback':
        if not args.revision:raise RuntimeError('rollback requires --revision OPENCLAW_ONLY_COMMIT_TO_REVERT')
        import re
        if not re.fullmatch('[a-fA-F0-9]{7,40}',args.revision):raise RuntimeError('Use a hexadecimal commit SHA')
        paths=run(['git','diff-tree','--no-commit-id','--name-only','-r',args.revision],True,cwd=ROOT).splitlines()
        if not paths or any(not f.startswith(('minikube/openclaw/','services/mcp-server/operations/','docs/openclaw/','scripts/openclaw')) for f in paths):raise RuntimeError('Commit is not isolated to OpenClaw; prepare a reviewed rollback PR manually.')
        if run(['git','status','--porcelain'],True,cwd=ROOT).strip():raise RuntimeError('Working tree must be clean before rollback preparation')
        confirm('rollback');run(['git','revert','--no-commit',args.revision],cwd=ROOT)
        print('Rollback staged locally. Review, commit and push through branch protection; Argo will reconcile. No live rollback bypass.')
    elif args.command=='backup':backup(args)
    elif args.command=='restore':restore(args)
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except (RuntimeError,subprocess.CalledProcessError,FileNotFoundError) as e:
        print('ERROR:',str(e),file=sys.stderr);sys.exit(1)
