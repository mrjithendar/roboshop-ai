#!/usr/bin/env bash
# Project API keys are entered privately and merged into the existing app Secret.
set +x
set -euo pipefail
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
python3 - <<'PY'
import getpass,json,os,subprocess
base=['kubectl','--context='+os.environ['KUBE_CONTEXT'],'--request-timeout=30s','-n','roboshop-ai']
subprocess.run(base+['get','secret','roboshop-secrets','-o','name'],check=True)
public=getpass.getpass('Langfuse project public key (pk-lf-…): ')
secret=getpass.getpass('Langfuse project secret key (sk-lf-…): ')
if not public.startswith('pk-lf-') or not secret.startswith('sk-lf-') or any(c.isspace() for c in public+secret):
    raise SystemExit('Invalid project key format; no changes made.')
patch={'stringData':{'LANGFUSE_BASE_URL':'http://langfuse-web.langfuse.svc.cluster.local:3000','LANGFUSE_PUBLIC_KEY':public,'LANGFUSE_SECRET_KEY':secret}}
subprocess.run(base+['patch','secret','roboshop-secrets','--type=merge','--patch-file=/dev/stdin'],input=json.dumps(patch),text=True,check=True)
subprocess.run(base+['rollout','restart','deployment/shopping-agent'],check=True)
print('Keys saved; shopping-agent restarted. Its deployed manifest must include the optional Langfuse Secret references.')
PY
