#!/usr/bin/env bash
# Read existing project keys without prompting or logging secret values.
set +x
set -euo pipefail
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
export LANGFUSE_SECRET_NAME=${LANGFUSE_SECRET_NAME:-langfuse-credentials}
python3 - <<'PY'
import base64,json,os,subprocess
base=['kubectl','--context='+os.environ['KUBE_CONTEXT'],'--request-timeout=30s','-n','roboshop-ai']
def read_secret(name):
    result=subprocess.run(base+['get','secret',name,'--ignore-not-found','-o','json'],capture_output=True,text=True)
    if result.returncode:
        raise SystemExit('Cannot read Secret '+name+'; check Kubernetes access. No changes made.')
    return json.loads(result.stdout) if result.stdout.strip() else None

target=read_secret('roboshop-secrets')
if target is None:
    raise SystemExit('Required application Secret roboshop-secrets is missing; no changes made.')
source_name=os.environ['LANGFUSE_SECRET_NAME']
source=read_secret(source_name) if source_name != 'roboshop-secrets' else target
if source is None:
    source=target
    source_name='roboshop-secrets'
def decode(key):
    try:
        return base64.b64decode(source.get('data',{}).get(key,''),validate=True).decode('utf-8')
    except (ValueError,UnicodeError):
        raise SystemExit('Invalid encoded Langfuse credentials; no changes made.')
public=decode('LANGFUSE_PUBLIC_KEY')
secret=decode('LANGFUSE_SECRET_KEY')
if not public.startswith('pk-lf-') or not secret.startswith('sk-lf-') or any(c.isspace() for c in public+secret):
    raise SystemExit('Missing or invalid Langfuse project keys in ' + source_name + '; no changes made.')
url=(os.environ.get('LANGFUSE_BASE_URL') or decode('LANGFUSE_BASE_URL')).rstrip('/')
allowed={'https://cloud.langfuse.com','https://us.cloud.langfuse.com','https://jp.cloud.langfuse.com','https://hipaa.cloud.langfuse.com'}
if url not in allowed:
    raise SystemExit('Set LANGFUSE_BASE_URL to your Langfuse Cloud project region, in the source Secret or environment. No changes made.')
patch={'stringData':{'LANGFUSE_BASE_URL':url,'LANGFUSE_PUBLIC_KEY':public,'LANGFUSE_SECRET_KEY':secret}}
result=subprocess.run(base+['patch','secret','roboshop-secrets','--type=merge','--patch-file=/dev/stdin'],input=json.dumps(patch),text=True,capture_output=True)
if result.returncode:
    raise SystemExit('Could not update roboshop-secrets; check Kubernetes permissions. Secret values were not logged.')
subprocess.run(base+['rollout','restart','deployment/moks'],check=True)
print('Keys loaded from '+source_name+' and saved to roboshop-secrets; moks restarted.')
PY
