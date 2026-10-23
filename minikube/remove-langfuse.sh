#!/usr/bin/env bash
# Removes self-hosted compute/network resources while retaining database state
# and credentials. Inventory failures must stop deletion; an unreachable API must
# never be interpreted as an empty or successfully removed installation.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Usage: bash minikube/remove-langfuse.sh --help
case "${1:-}" in --help|-h) echo 'Purpose: Remove self-hosted compute/network resources, retaining databases and credentials.'; echo 'Usage: bash minikube/remove-langfuse.sh; see docs/operations/script-audit.md for prerequisites, variables and effects.'; exit 0;; esac
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
