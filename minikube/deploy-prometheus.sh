#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/deploy-prometheus.sh'
  echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT. Values: minikube/prometheus/values.yaml'
  exit 0
fi
[[ $# == 0 ]] || fail 'No positional arguments expected.'
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
for command in helm kubectl python3; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required."
done
PROFILE="${PROFILE:-mk4}"
[[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid PROFILE.'
if [[ -z "${KUBE_CONTEXT:-}" ]]; then
  state="${MINIKUBE_HOME:-$HOME/.minikube}/robotshop-installer/$PROFILE.profile"
  if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
  KUBE_CONTEXT="$PROFILE"
fi
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid KUBE_CONTEXT.'
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
h() { helm --kube-context="$KUBE_CONTEXT" "$@"; }
echo "Deploying Prometheus into context $KUBE_CONTEXT, namespace robotshop-ai."
k --request-timeout=15s get namespace kube-system >/dev/null
k get ingressclass traefik >/dev/null || fail 'Run deploy-traefik.sh and expose-ingress.sh first.'
k get crd middlewares.traefik.io >/dev/null || fail 'Traefik Middleware CRDs are required. Run deploy-traefik.sh.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Run deploy-cert-manager.sh first.'
k create namespace robotshop-ai --dry-run=client -o yaml | k apply -f -
existing="$(k -n robotshop-ai get secret prometheus-auth --ignore-not-found -o name)"
if [[ -z "$existing" ]]; then
  temp="$(mktemp -d)"
  trap 'rm -rf "$temp"' EXIT
  python3 - "$temp/secret.json" <<'PYSECRET'
import json, os, secrets, sys
payload = {'apiVersion':'v1', 'kind':'Secret',
           'metadata': {'name':'prometheus-auth','namespace':'robotshop-ai'},
           'type':'kubernetes.io/basic-auth',
           'stringData': {'username':'admin','password':secrets.token_hex(32)}}
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump(payload, file)
PYSECRET
  k create -f "$temp/secret.json"
  rm -rf "$temp"
  trap - EXIT
fi
k apply -f "$SCRIPT_DIR/cert-manager/certificate.example.yaml"
h upgrade --install prometheus "$SCRIPT_DIR/prometheus" --namespace robotshop-ai --wait --timeout 10m
k -n robotshop-ai wait --for=condition=Ready certificate/jithendar-com --timeout=10m
k -n robotshop-ai get deployment/prometheus ingress/prometheus pvc/prometheus-data
echo 'Prometheus is ready at https://jithendar.com/prometheus/ (username: admin).'
echo 'Retrieve its password:'
printf 'kubectl --context=%q -n robotshop-ai get secret prometheus-auth -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.password}' | base64 --decode; echo\n"
echo 'To provision the Grafana data source, run:'
printf 'KUBE_CONTEXT=%q bash minikube/deploy-grafana.sh\n' "$KUBE_CONTEXT"
