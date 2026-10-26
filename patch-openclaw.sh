#!/usr/bin/env bash
# Apply local OpenClaw corrections through Argo CD, without direct workload writes.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  --help|-h)
    echo 'Usage: ./patch-openclaw.sh [--dry-run]'
    echo 'Reads local manifests, patches the existing Argo CD Application, and requests sync.'
    echo 'Context: KUBE_CONTEXT or OPENCLAW_CONTEXT (default mk4); must already be current.'
    echo 'Requires kubectl and Python with PyYAML. Does not create or rotate credentials.'
    exit 0 ;;
  ''|--dry-run) ;;
  *) echo 'Use --help for usage.' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Expected at most one option.' >&2; exit 2; }
exec "${PYTHON:-python3}" - "$ROOT" "${KUBE_CONTEXT:-${OPENCLAW_CONTEXT:-mk4}}" "${1:-}" <<'PY'
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import yaml

root, context, option = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
base = root / 'minikube/openclaw/base'
application = yaml.safe_load((root / 'argocd/openclaw.yaml').read_text())
workloads = list(yaml.safe_load_all((base / 'workloads.yaml').read_text()))
egress = list(yaml.safe_load_all((base / 'egress.yaml').read_text()))
network_policies = list(yaml.safe_load_all((base / 'networkpolicies.yaml').read_text()))
# Squid must restart when its mounted configuration changes.
egress_config = next(d for d in egress if d['kind'] == 'ConfigMap')
egress_deployment = next(d for d in egress if d['kind'] == 'Deployment')
egress_deployment['spec']['template']['metadata'].setdefault('annotations', {})['checksum/squid-config'] = hashlib.sha256(egress_config['data']['squid.conf'].encode()).hexdigest()
gateway = next(d for d in workloads if d['kind'] == 'Deployment' and d['metadata']['name'] == 'openclaw')
operations = next(d for d in workloads if d['kind'] == 'Deployment' and d['metadata']['name'] == 'openclaw-operations')
node = yaml.safe_load((root / 'minikube/openclaw/overlays/mk4/state-node.yaml').read_text())
ingress = list(yaml.safe_load_all((root / 'minikube/openclaw/overlays/mk4/ingress.yaml').read_text()))
config = {'apiVersion': 'v1', 'kind': 'ConfigMap',
          'metadata': {'name': 'openclaw-config', 'namespace': 'openclaw'},
          'data': {'openclaw.json': (base / 'openclaw.json').read_text()}}

# Keep the readable workload/config files as the only source of patch content.
# Kustomize resolves the config generator's hash after applying these patches.
source = copy.deepcopy(application['spec']['source'])
source['kustomize'] = {
    'images': [
        '528804350166.dkr.ecr.us-east-1.amazonaws.com/roboshop-mcp-server='
        + gateway['spec']['template']['spec']['initContainers'][0]['image']
    ],
    'patches': [
        {'target': {'kind': d['kind'], 'name': d['metadata']['name']},
         'patch': yaml.safe_dump(d, sort_keys=False)}
        for d in [gateway, operations, node, config, *ingress, *egress, *network_policies]
    ],
}
patch = {'spec': {'source': source},
         'operation': {'initiatedBy': {'username': 'patch-openclaw'},
                       'sync': {'prune': False, 'syncStrategy': {'hook': {}}}}}
if option == '--dry-run':
    print(json.dumps(patch, indent=2))
    sys.exit(0)

kubectl = ['kubectl', '--context', context, '--request-timeout=20s']
current = subprocess.check_output(['kubectl', 'config', 'current-context'], text=True).strip()
if current != context:
    sys.exit(f'Context mismatch: expected {context}, current {current}. No changes made.')
live = json.loads(subprocess.check_output(kubectl + ['-n', 'argocd', 'get', 'application', 'openclaw', '-o', 'json'], text=True))
if live.get('operation'):
    sys.exit('An Argo CD operation is already active; wait for it to finish before retrying.')
# Submit through stdin so the generated patch never needs a temporary file.
subprocess.run(kubectl + ['-n', 'argocd', 'patch', 'application', 'openclaw',
                         '--type=merge', '--patch-file=/dev/stdin'],
               input=json.dumps(patch), text=True, check=True)
print('OpenClaw patches applied and Argo CD sync requested. Check rollout/health in Argo CD.')
PY
