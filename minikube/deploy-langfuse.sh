#!/usr/bin/env bash
# Install the optional private Langfuse dashboard. Never replace stored credentials.
set +x
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
for tool in helm kubectl python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
# Chart dependency uses template functions absent from older Helm releases.
python3 - "$(helm version --template '{{.Version}}')" <<'PYHELM'
import re, sys
match=re.match(r'v?(\d+)\.(\d+)\.(\d+)', sys.argv[1])
if not match or tuple(map(int,match.groups())) < (4,3,1):
    raise SystemExit('Helm 4.3.1 or newer is required for the pinned Langfuse chart; upgrade Helm before installing.')
PYHELM
k() { kubectl --context="$KUBE_CONTEXT" --request-timeout=30s "$@"; }
k get namespace kube-system >/dev/null
k create namespace langfuse --dry-run=client -o yaml | k apply -f -
python3 - <<'PY'
import os, json, secrets, subprocess
base=['kubectl','--context='+os.environ['KUBE_CONTEXT'],'--request-timeout=30s','-n','langfuse']
found=subprocess.check_output(base+['get','secret','langfuse-clickhouse','--ignore-not-found','-o','name'],text=True).strip()
if not found:
    claims=json.loads(subprocess.check_output(base+['get','pvc','-o','json']))['items']
    if claims:
        raise SystemExit('Existing Langfuse storage without its ClickHouse secret: restore credentials from backup; refusing to generate replacements.')
    secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'langfuse-clickhouse','namespace':'langfuse'},'stringData':{'password':secrets.token_hex(32)}}
    subprocess.run(base+['create','-f','-'],input=json.dumps(secret),text=True,check=True)
PY
k apply -f "$script_dir/langfuse/clickhouse.yaml"
helm upgrade --install langfuse langfuse --kube-context "$KUBE_CONTEXT" \
  --repo https://langfuse.github.io/langfuse-k8s --version 2.1.6 \
  --namespace langfuse -f "$script_dir/langfuse/values.yaml" --timeout 10m
printf '\nLangfuse resources applied. Inspect startup with: kubectl --context=%q -n langfuse get pods,pvc\n' "$KUBE_CONTEXT"
printf 'Dashboard: kubectl --context=%q -n langfuse port-forward svc/langfuse-web 3000:3000\n' "$KUBE_CONTEXT"
echo 'Open http://localhost:3000, create your account/project, then run bash minikube/connect-langfuse.sh.'
