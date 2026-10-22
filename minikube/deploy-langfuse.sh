#!/usr/bin/env bash
# Install the optional Langfuse dashboard at /langfuse. Never replace stored credentials.
set +x
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
for tool in helm kubectl python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
# Resolve a runnable CLI, not just the first file named aws. An old Intel
# installer can shadow native Homebrew AWS CLI on Apple Silicon. Keep the
# selected absolute path for both shell calls and Python subprocesses.
aws_candidates=()
if [[ -n "${AWS_CLI:-}" ]]; then
  aws_candidates+=("$AWS_CLI")
else
  while IFS= read -r candidate; do aws_candidates+=("$candidate"); done < <(type -aP aws || true)
  if [[ "$(uname -s)" == Darwin ]]; then
    aws_candidates+=(/opt/homebrew/bin/aws /usr/local/bin/aws)
  fi
fi
selected_aws=''
for candidate in "${aws_candidates[@]}"; do
  if [[ -x "$candidate" ]] && "$candidate" --version >/dev/null 2>&1; then
    selected_aws="$candidate"
    break
  fi
done
if [[ -z "$selected_aws" ]]; then
  echo 'No runnable AWS CLI found. Install AWS CLI for your CPU architecture, or set AWS_CLI to a working executable path.' >&2
  exit 1
fi
export AWS_CLI="$selected_aws"
echo "Using AWS CLI: $AWS_CLI"
# Chart dependency uses template functions absent from older Helm releases.
python3 - "$(helm version --template '{{.Version}}')" <<'PYHELM'
import re, sys
match=re.match(r'v?(\d+)\.(\d+)\.(\d+)', sys.argv[1])
if not match or tuple(map(int,match.groups())) < (4,3,1):
    raise SystemExit('Helm 4.3.1 or newer is required for the pinned Langfuse chart; upgrade Helm before installing.')
PYHELM
k() { kubectl --context="$KUBE_CONTEXT" --request-timeout=30s "$@"; }
python3 -c 'import yaml' || { echo 'Install PyYAML: python3 -m pip install PyYAML' >&2; exit 1; }
# Check publication before installing plugins or changing cluster resources.
if ! "$AWS_CLI" ecr describe-images --region us-east-1 --registry-id 881026659929 --repository-name roboshop-langfuse --image-ids imageTag=4.63.0-subpath --query 'imageDetails[0].imageDigest' --output text >/dev/null; then
  cat >&2 <<'BUILD_FIRST'
ERROR: Cannot access the required Langfuse subpath image in ECR.
If the repository or image is missing:
  1. Publish .github/workflows/ci-langfuse.yml to the default GitHub branch.
  2. Run the "Langfuse subpath image" workflow and wait for it to succeed.
     It creates roboshop-langfuse and pushes tag 4.63.0-subpath.
  3. Rerun bash minikube/deploy-langfuse.sh.
For credential or access errors, resolve the AWS error above instead.
No Kubernetes resources were changed. Creating an empty repository alone is not enough.
BUILD_FIRST
  exit 1
fi
plugin_dir=$(mktemp -d)
trap 'rm -rf "$plugin_dir"' EXIT
export HELM_DATA_HOME="$plugin_dir"
export HELM_PLUGINS="$plugin_dir/plugins"
mkdir -p "$HELM_PLUGINS"
helm plugin install "$script_dir/langfuse/postrenderer"
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$script_dir/setup-shared-tls.sh"
k get namespace kube-system >/dev/null
k create namespace langfuse --dry-run=client -o yaml | k apply -f -
python3 - <<'PY'
import os, json, secrets, subprocess, base64
base=['kubectl','--context='+os.environ['KUBE_CONTEXT'],'--request-timeout=30s','-n','langfuse']
found=subprocess.check_output(base+['get','secret','langfuse-clickhouse','--ignore-not-found','-o','name'],text=True).strip()
if not found:
    claims=json.loads(subprocess.check_output(base+['get','pvc','-o','json']))['items']
    if claims:
        raise SystemExit('Existing Langfuse storage without its ClickHouse secret: restore credentials from backup; refusing to generate replacements.')
    secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'langfuse-clickhouse','namespace':'langfuse'},'stringData':{'password':secrets.token_hex(32)}}
    subprocess.run(base+['create','-f','-'],input=json.dumps(secret),text=True,check=True)
password=subprocess.check_output([os.environ['AWS_CLI'],'ecr','get-login-password','--region','us-east-1'],text=True).strip()
registry='881026659929.dkr.ecr.us-east-1.amazonaws.com'
auth=base64.b64encode(('AWS:'+password).encode()).decode()
pull={'apiVersion':'v1','kind':'Secret','metadata':{'name':'ecr-pull','namespace':'langfuse'},'type':'kubernetes.io/dockerconfigjson','stringData':{'.dockerconfigjson':json.dumps({'auths':{registry:{'auth':auth}}})}}
subprocess.run(base+['apply','-f','-'],input=json.dumps(pull),text=True,check=True)
PY
k apply -f "$script_dir/langfuse/clickhouse.yaml"
helm upgrade --install langfuse langfuse --kube-context "$KUBE_CONTEXT" \
  --repo https://langfuse.github.io/langfuse-k8s --version 2.1.6 \
  --namespace langfuse -f "$script_dir/langfuse/values.yaml" --post-renderer roboshop-langfuse-permissions --timeout 10m
k apply -f "$script_dir/langfuse/ingress.yaml"
echo 'Submitted: https://jithendar.com/langfuse/ (pods may still be starting).'
echo 'Inspect: kubectl -n langfuse get pods,pvc; connect keys with bash minikube/connect-langfuse.sh.'
