#!/usr/bin/env bash
# Deploys Grafana in monitoring, reusing managed credentials and shared TLS.
# Legacy-resource checks avoid creating two competing installations. Do not
# delete a PVC merely to resolve a failed rollout; it contains dashboard state.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
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
for command in helm kubectl python3; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required."
done
PROFILE="${PROFILE:-mk4}"
[[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid PROFILE.'
if [[ -z "${KUBE_CONTEXT:-}" ]]; then
  state="${MINIKUBE_HOME:-$HOME/.minikube}/roboshop-installer/$PROFILE.profile"
  if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
  KUBE_CONTEXT="$PROFILE"
fi
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid KUBE_CONTEXT.'
GRAFANA_CHART_VERSION="${GRAFANA_CHART_VERSION:-14.0.1}"
[[ "$GRAFANA_CHART_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid GRAFANA_CHART_VERSION.'
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
h() { helm --kube-context="$KUBE_CONTEXT" "$@"; }
echo "Deploying Grafana into context $KUBE_CONTEXT, namespace monitoring."
bash "$SCRIPT_DIR/../scripts/lib/check-argocd-ownership.sh" "$KUBE_CONTEXT" grafana
k --request-timeout=15s get namespace kube-system >/dev/null
k --request-timeout=15s get ingressclass traefik >/dev/null || fail 'Run bash minikube/deploy-traefik.sh, then on Vultr run bash minikube/expose-ingress.sh. See minikube/traefik/README.md.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Run minikube/deploy-cert-manager.sh first.'
# Keep the site certificate in the same namespace as the Grafana Ingress.
# Namespace changes do not migrate Helm releases or persistent data.
legacy="$(k -n roboshop-ai get deployment/grafana ingress/grafana pvc/grafana --ignore-not-found -o name)"
[[ -z "$legacy" ]] || fail 'Existing grafana resources found in roboshop-ai. Migrate data and credentials before switching namespaces; see minikube/monitoring/README.md. No resources were moved or deleted.'
k create namespace monitoring --dry-run=client -o yaml | k apply -f -
python3 "$SCRIPT_DIR/monitoring/credentials.py" ensure --context "$KUBE_CONTEXT"
# Both installers reconcile this SAME namespace/name; this is not a per-app certificate.
echo 'TLS: ensuring shared Certificate jithendar/jithendar-com via Traefik TLSStore.'
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/setup-shared-tls.sh"
h upgrade --install grafana grafana \
  --repo https://grafana-community.github.io/helm-charts \
  --version "$GRAFANA_CHART_VERSION" --namespace monitoring \
  -f "$SCRIPT_DIR/monitoring/grafana/values.yaml" --wait --timeout 10m
echo 'Synchronizing Grafana administrator with the shared monitoring-auth Secret...'
python3 "$SCRIPT_DIR/monitoring/credentials.py" sync-grafana --context "$KUBE_CONTEXT"
if ! k -n jithendar wait --for=condition=Ready certificate/jithendar-com --timeout=10m; then
  k -n jithendar describe certificate jithendar-com
  fail 'Grafana is installed but HTTPS is not ready. Check DNS, public port 80 and ACME Challenge events. See minikube/monitoring/grafana/README.md.'
fi
k -n monitoring get deployment/grafana ingress/grafana
echo 'Grafana and its certificate are ready: https://jithendar.com/grafana/'
echo 'Login user: admin. Retrieve the shared password (not printed automatically):'
printf 'kubectl --context=%q -n monitoring get secret monitoring-auth -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.password}' | base64 --decode; echo\n"
echo 'See minikube/monitoring/grafana/README.md for verification and connecting Prometheus.'
