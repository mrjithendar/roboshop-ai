#!/usr/bin/env bash
# Deploy Grafana at https://jithendar.com/grafana using the shared site certificate.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
case "${1:-}" in
  -h|--help)
    echo 'Usage: bash minikube/deploy-grafana.sh'
    echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT, GRAFANA_CHART_VERSION=14.0.1'
    echo 'Requires Helm, kubectl, Traefik, letsencrypt-prod and public ingress ports 80/443.'
    exit 0 ;;
  '') ;;
  *) fail 'No positional arguments expected.' ;;
esac
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
GRAFANA_CHART_VERSION="${GRAFANA_CHART_VERSION:-14.0.1}"
[[ "$GRAFANA_CHART_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid GRAFANA_CHART_VERSION.'
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
h() { helm --kube-context="$KUBE_CONTEXT" "$@"; }
echo "Deploying Grafana into context $KUBE_CONTEXT, namespace robotshop-ai."
k --request-timeout=15s get namespace kube-system >/dev/null
k --request-timeout=15s get ingressclass traefik >/dev/null || fail 'Install Traefik and expose its ports 80/443 first.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Run minikube/deploy-cert-manager.sh first.'
# Keep the site certificate in the same namespace as the Grafana Ingress.
k create namespace robotshop-ai --dry-run=client -o yaml | k apply -f -
k apply -f "$SCRIPT_DIR/cert-manager/certificate.example.yaml"
h upgrade --install grafana grafana \
  --repo https://grafana-community.github.io/helm-charts \
  --version "$GRAFANA_CHART_VERSION" --namespace robotshop-ai \
  -f "$SCRIPT_DIR/grafana/values.yaml" --wait --timeout 10m
if ! k -n robotshop-ai wait --for=condition=Ready certificate/jithendar-com --timeout=10m; then
  k -n robotshop-ai describe certificate jithendar-com
  fail 'Grafana is installed but HTTPS is not ready. Check DNS, public port 80 and ACME Challenge events. See minikube/grafana/README.md.'
fi
k -n robotshop-ai get deployment/grafana ingress/grafana certificate/jithendar-com
echo 'Grafana and its certificate are ready: https://jithendar.com/grafana/'
echo 'Login user: admin. Retrieve the initial password (not printed automatically):'
printf 'kubectl --context=%q -n robotshop-ai get secret grafana -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.admin-password}' | base64 --decode; echo\n"
echo 'See minikube/grafana/README.md for verification and connecting Prometheus.'
