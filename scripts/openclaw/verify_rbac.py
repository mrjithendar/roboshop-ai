#!/usr/bin/env python3
"""Read-only authorization review against the deployed service account."""
import subprocess
from manage import context
ctx=context();identity='system:serviceaccount:openclaw:openclaw-operations'
checks=[('get','pods','roboshop-ai',True),('get','pods/log','roboshop-ai',True),('list','events','roboshop-ai',True),('get','deployments.apps','roboshop-ai',True),('get','applications.argoproj.io','argocd',True),('get','secrets','roboshop-ai',False),('create','pods/exec','roboshop-ai',False),('delete','pods','roboshop-ai',False),('patch','applications.argoproj.io','argocd',False),('get','pods','default',False)]
for verb,resource,namespace,allowed in checks:
 result=subprocess.run(['kubectl','--context',ctx,'auth','can-i',verb,resource,'-n',namespace,'--as',identity],text=True,capture_output=True,timeout=15)
 if (result.stdout.strip()=='yes')!=allowed:raise SystemExit(f'FAIL: {verb} {resource} in {namespace}')
print('PASS: deployed operations RBAC permits required reads and rejects tested privilege escalations')
