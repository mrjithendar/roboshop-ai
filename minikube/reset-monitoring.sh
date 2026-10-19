#!/usr/bin/env bash
# DESTRUCTIVE: remove monitoring application data and credentials, then reinstall.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  echo 'Usage: bash minikube/reset-monitoring.sh'
  echo 'DELETES Grafana dashboards/users/settings, Prometheus history and monitoring login credentials.'
  echo 'Removes only Grafana/Prometheus resources in monitoring and robotshop-ai, then reinstalls in monitoring.'
  echo 'Preserves namespaces, TLS certificates, WordPress and RobotShop workloads.'
  echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT. Uses the same context for deletion and reinstall.'
  exit 0
fi
[[ $# == 0 ]] || fail 'No arguments expected; see --help.'
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
# Check access, prerequisites and legacy resources before deleting anything.
k --request-timeout=15s get namespace kube-system >/dev/null
k get ingressclass traefik >/dev/null || fail 'Traefik is required for reinstall.'
k get crd middlewares.traefik.io >/dev/null || fail 'Traefik Middleware CRDs are required.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Let’s Encrypt issuer must be ready before resetting.'
for script in deploy-prometheus.sh deploy-grafana.sh; do
  [[ -f "$SCRIPT_DIR/$script" ]] || fail "Missing reinstall script: $script"
done
echo "DESTRUCTIVE RESET: context=$KUBE_CONTEXT namespaces=monitoring,robotshop-ai"
echo 'Deleting Grafana/Prometheus releases, their data volumes, and shared/old login Secrets.'
echo 'Namespaces, TLS certificates, WordPress and RobotShop workloads are preserved.'
for reset_namespace in robotshop-ai monitoring; do
  echo "Removing only Grafana/Prometheus resources from $reset_namespace..."
for release in grafana prometheus; do
  found="$(h list --namespace "$reset_namespace" --all --filter "^$release$" --short)"
  if [[ -n "$found" ]]; then
    h uninstall "$release" --namespace "$reset_namespace" --wait --timeout 5m
  fi
done
# Clean up known app resources left by failed/partial Helm operations.
k -n "$reset_namespace" delete deployment/grafana deployment/prometheus \
  --ignore-not-found --cascade=foreground --wait=true --timeout=5m
k -n "$reset_namespace" delete pod -l app.kubernetes.io/name=grafana,app.kubernetes.io/instance=grafana \
  --ignore-not-found --wait=true --timeout=5m
k -n "$reset_namespace" delete pod -l app=robotshop-prometheus \
  --ignore-not-found --wait=true --timeout=5m
k -n "$reset_namespace" delete ingress/grafana ingress/prometheus service/grafana service/prometheus \
  configmap/grafana configmap/grafana-datasource configmap/prometheus-config \
  middleware.traefik.io/prometheus-auth --ignore-not-found --wait=true --timeout=2m
# Helm keep-policy PVCs require explicit deletion. Wait until gone before reinstall.
k -n "$reset_namespace" delete pvc/grafana pvc/prometheus-data --ignore-not-found --wait=true --timeout=5m
k -n "$reset_namespace" delete secret/monitoring-auth secret/grafana secret/prometheus-auth \
  --ignore-not-found --wait=true --timeout=2m
done
echo 'Old monitoring data and login Secrets removed. Installing fresh applications...'
# Explicitly pass context; never let child scripts select a different cluster.
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/deploy-prometheus.sh"
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/deploy-grafana.sh"
echo 'Fresh monitoring installation complete. Both applications use username admin and a NEW shared password.'
printf 'kubectl --context=%q -n monitoring get secret monitoring-auth -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.password}' | base64 --decode; echo\n"

