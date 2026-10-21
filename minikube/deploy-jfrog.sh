#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-install}"
case "$mode" in
  --help|-h) echo 'Usage: bash minikube/deploy-jfrog.sh [--check | --render-only | install]'; exit 0 ;;
  --check|--render-only|install) ;;
  *) echo 'Unknown option.' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
CHART_VERSION=107.161.26
JFROG_SIZE="${JFROG_SIZE:-standard}"
case "$JFROG_SIZE" in standard|minimal) ;; *) echo 'JFROG_SIZE must be standard or minimal.' >&2; exit 2;; esac
values=(-f "$SCRIPT_DIR/jfrog/values.yaml")
if [[ "$JFROG_SIZE" == minimal ]]; then
  values+=(-f "$SCRIPT_DIR/jfrog/values-minimal.yaml")
  echo 'Experimental minimal JFrog profile: below vendor sizing; startup and workload stability are not guaranteed.' >&2
fi
command -v python3 >/dev/null
if [[ "$mode" == --render-only ]]; then
  helm template jfrog artifactory-jcr --repo https://charts.jfrog.io --version "$CHART_VERSION" --namespace jfrog "${values[@]}"
  exit 0
fi
PROFILE="${PROFILE:-mk4}"
[[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 2
if [[ -z "${KUBE_CONTEXT:-}" ]]; then
  state="${MINIKUBE_HOME:-$HOME/.minikube}/roboshop-installer/$PROFILE.profile"
  if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
fi
KUBE_CONTEXT="${KUBE_CONTEXT:-$PROFILE}"
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 2
if [[ -z "${KUBECONFIG:-}" && -f "$HOME/.kube/vultr-minikube.json" ]]; then export KUBECONFIG="$HOME/.kube/vultr-minikube.json"; fi
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
python3 "$SCRIPT_DIR/jfrog/preflight.py" --context "$KUBE_CONTEXT" --size "$JFROG_SIZE"
k --request-timeout=15s get ingressclass traefik >/dev/null
k --request-timeout=15s get crd middlewares.traefik.io >/dev/null
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s
if [[ "$mode" == --check ]]; then exit 0; fi
command -v helm >/dev/null
k create namespace jfrog --dry-run=client -o yaml | k apply -f -
python3 "$SCRIPT_DIR/jfrog/bootstrap.py" --context "$KUBE_CONTEXT"
helm upgrade --install jfrog artifactory-jcr --repo https://charts.jfrog.io \
  --version "$CHART_VERSION" --kube-context "$KUBE_CONTEXT" --namespace jfrog \
  "${values[@]}" --wait --timeout 20m
# Publish only after a successful installation with non-default credentials.
k apply -f "$SCRIPT_DIR/jfrog/ingress.yaml"
if ! k -n jfrog wait --for=condition=Ready certificate/jfrog-public --timeout=5m; then
  k -n jfrog get certificate,certificaterequest,order,challenge
  echo 'JFrog installed; certificate pending. Check DNS and port 80, then rerun.' >&2
  exit 1
fi
echo 'JFrog: https://jfrog.jithendar.com/ui/ (shortcut: https://jithendar.com/jfrog)'
echo 'Administrator: admin. Retrieve the generated password with the command in minikube/jfrog/README.md.'
