#!/usr/bin/env bash
# Remove self-hosted compute/network resources, retaining databases and credentials.
set -euo pipefail
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
python3 - <<'PY'
import json,os,subprocess
base=['kubectl','--context='+os.environ['KUBE_CONTEXT'],'--request-timeout=15s','-n','langfuse']
try:
    result=subprocess.run(base+['get','deployments,statefulsets,services,ingresses,certificates','-o','json'],capture_output=True,text=True,timeout=30)
except subprocess.TimeoutExpired:
    raise SystemExit('Cluster inventory timed out; no changes made. Retry when the API is reachable.')
if result.returncode:
    raise SystemExit('Cannot inventory Langfuse resources; no changes made. Check cluster connectivity.')
resources=json.loads(result.stdout)['items']
for resource in resources:
    name=resource['metadata']['name']
    if not name.startswith('langfuse'):
        continue
    kind=resource['kind'].lower()
    if kind=='statefulset':
        patch={'spec':{'persistentVolumeClaimRetentionPolicy':{'whenDeleted':'Retain','whenScaled':'Retain'}}}
        subprocess.run(base+['patch',kind,name,'--type=merge','-p',json.dumps(patch)],check=True)
    subprocess.run(base+['delete',kind,name,'--ignore-not-found','--wait=false'],check=True)
print('Removed Langfuse workloads and routes. PVCs, Secrets, ConfigMaps and Helm release metadata retained for recovery; do not helm upgrade the retired release.')
PY
