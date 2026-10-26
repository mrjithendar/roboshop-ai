#!/usr/bin/env python3
"""Refresh only the OpenClaw ECR pull credential using the existing runner identity."""
import base64,json,subprocess,sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from manage import context,confirm
ctx=context()
if '--ci' in sys.argv:
    if os.getenv('GITHUB_ACTIONS')!='true' or os.getenv('OPENCLAW_REGISTRY_REFRESH_ENABLED')!='true':raise SystemExit('CI credential refresh is not enabled')
else:confirm('refresh-registry')
registry='528804350166.dkr.ecr.us-east-1.amazonaws.com'
password=subprocess.check_output(['aws','ecr','get-login-password','--region','us-east-1'],text=True).strip()
config={'auths':{registry:{'auth':base64.b64encode(('AWS:'+password).encode()).decode()}}}
secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'openclaw-registry','namespace':'openclaw'},'type':'kubernetes.io/dockerconfigjson','data':{'.dockerconfigjson':base64.b64encode(json.dumps(config).encode()).decode()}}
subprocess.run(['kubectl','--context',ctx,'apply','--server-side','--field-manager=openclaw-registry','-f','-'],input=json.dumps(secret),text=True,check=True,stdout=subprocess.DEVNULL)
print('OpenClaw pull credential refreshed; values were not printed. ECR credentials expire after 12 hours.')
