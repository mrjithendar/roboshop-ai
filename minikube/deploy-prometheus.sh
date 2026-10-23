#!/usr/bin/env bash
# Deploys metrics storage and its authenticated ingress in monitoring.
# A bound PVC does not guarantee writable storage or a healthy server. Failure
# diagnostics should guide recovery without discarding metrics or credentials.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Tolerate invocation through sh; the host gate still requires CentOS.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/deploy-prometheus.sh'
  echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT. Values: minikube/monitoring/prometheus/values.yaml'
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
  state="${MINIKUBE_HOME:-$HOME/.minikube}/roboshop-installer/$PROFILE.profile"
  if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
  KUBE_CONTEXT="$PROFILE"
fi
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid KUBE_CONTEXT.'
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
h() { helm --kube-context="$KUBE_CONTEXT" "$@"; }
echo "Deploying Prometheus into context $KUBE_CONTEXT, namespace monitoring."
k --request-timeout=15s get namespace kube-system >/dev/null
k get ingressclass traefik >/dev/null || fail 'Run deploy-traefik.sh and expose-ingress.sh first.'
k get crd middlewares.traefik.io >/dev/null || fail 'Traefik Middleware CRDs are required. Run deploy-traefik.sh.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Run deploy-cert-manager.sh first.'
# Namespace changes do not migrate Helm releases or persistent data.
legacy="$(k -n roboshop-ai get deployment/prometheus ingress/prometheus pvc/prometheus-data --ignore-not-found -o name)"
[[ -z "$legacy" ]] || fail 'Existing prometheus resources found in roboshop-ai. Migrate data and credentials before switching namespaces; see minikube/monitoring/README.md. No resources were moved or deleted.'
k create namespace monitoring --dry-run=client -o yaml | k apply -f -
python3 "$SCRIPT_DIR/monitoring/credentials.py" ensure --context "$KUBE_CONTEXT"
# Both installers reconcile this SAME namespace/name; this is not a per-app certificate.
echo 'TLS: ensuring shared Certificate jithendar/jithendar-com via Traefik TLSStore.'
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/setup-shared-tls.sh"
diagnose() {
  echo 'Prometheus diagnostics (pods, storage, events and recent logs):' >&2
  k --request-timeout=15s -n monitoring get deployment/prometheus pvc/prometheus-data -o wide || true
  k --request-timeout=15s -n monitoring get pods -l app=roboshop-prometheus -o wide || true
  k --request-timeout=15s -n monitoring describe pvc prometheus-data || true
  k --request-timeout=15s -n monitoring describe pods -l app=roboshop-prometheus || true
  k --request-timeout=15s -n monitoring logs deployment/prometheus --tail=80 --pod-running-timeout=10s || true
  k --request-timeout=15s -n monitoring logs deployment/prometheus --previous --tail=40 --pod-running-timeout=10s || true
}
echo 'Applying Prometheus Helm release (namespace: monitoring)...'
# Let kubectl report rollout progress instead of Helm silently waiting for readiness.
if ! h upgrade --install prometheus "$SCRIPT_DIR/monitoring/prometheus" --namespace monitoring --wait=false --timeout 10m; then
  diagnose
  fail 'Helm could not apply Prometheus. Review the Helm error and diagnostics above.'
fi
echo 'Waiting up to 10 minutes for Prometheus. Image pulls, PVC provisioning and scheduling can delay startup.'
printf 'Inspect from another terminal: kubectl --context=%q -n monitoring get pods,pvc\n' "$KUBE_CONTEXT"
k --request-timeout=15s -n monitoring get pods -l app=roboshop-prometheus -o wide || true
k --request-timeout=15s -n monitoring get pvc prometheus-data || true
if ! k -n monitoring rollout status deployment/prometheus --timeout=10m; then
  diagnose
  fail 'Prometheus did not become ready. Check Pending/PVC events, ImagePullBackOff, or CrashLoopBackOff in the diagnostics above. Data and credentials were preserved.'
fi
echo 'Prometheus pod is ready. Checking the shared monitoring TLS certificate...'
if ! k -n jithendar wait --for=condition=Ready certificate/jithendar-com --timeout=10m; then
  k --request-timeout=15s -n jithendar describe certificate jithendar-com || true
  fail 'Prometheus is running, but its HTTPS certificate is not ready.'
fi
k -n monitoring get deployment/prometheus ingress/prometheus pvc/prometheus-data
echo 'Prometheus is ready at https://jithendar.com/prometheus/ (username: admin).'
echo 'Retrieve its password:'
printf 'kubectl --context=%q -n monitoring get secret monitoring-auth -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.password}' | base64 --decode; echo\n"
echo 'To provision the Grafana data source, run:'
printf 'KUBE_CONTEXT=%q bash minikube/deploy-grafana.sh\n' "$KUBE_CONTEXT"
