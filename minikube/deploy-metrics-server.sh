#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/deploy-metrics-server.sh'
  echo 'Installs Metrics Server in kube-system. Overrides: PROFILE=mk4, KUBE_CONTEXT.'
  exit 0
fi
[[ $# == 0 ]] || fail 'No positional arguments expected.'
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
for command in helm kubectl; do
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
echo "Installing Metrics Server in kube-system, context $KUBE_CONTEXT."
k --request-timeout=15s get namespace kube-system >/dev/null
helm --kube-context="$KUBE_CONTEXT" upgrade --install metrics-server metrics-server \
  --repo https://kubernetes-sigs.github.io/metrics-server/ --version 3.14.0 \
  --namespace kube-system -f "$SCRIPT_DIR/metrics-server/values.yaml" --wait=false --timeout 5m
if ! k -n kube-system rollout status deployment/metrics-server --timeout=5m; then
  k -n kube-system describe pods -l app.kubernetes.io/name=metrics-server || true
  k -n kube-system logs deployment/metrics-server --tail=80 || true
  fail 'Metrics Server is not ready; inspect the diagnostics above.'
fi
k wait --for=condition=Available apiservice/v1beta1.metrics.k8s.io --timeout=120s
for attempt in {1..12}; do
  if k top nodes && k top pods -n monitoring; then
    echo 'Metrics Server is ready; kubectl top and resource-based HPA metrics are available.'
    exit 0
  fi
  echo 'Waiting for the first resource metrics sample...'
  sleep 5
done
fail 'Metrics API registered, but samples are not available yet. Check Metrics Server logs.'
