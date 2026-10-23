#!/usr/bin/env bash
# Installs Argo CD behind the existing Traefik ingress and shared TLS setup.
# The chart release and public route are separate resources; applying them is
# not proof that the browser UI or certificate is already ready.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Install/update Argo CD behind the existing Traefik + Let's Encrypt setup.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  -h|--help)
    echo 'Usage: bash minikube/deploy-argocd.sh'
    echo 'Overrides: KUBE_CONTEXT=mk4 ARGOCD_CHART_VERSION=10.10.5'
    echo 'Requires existing Traefik, letsencrypt-prod and public ports 80/443.'
    exit 0 ;;
  '') ;;
  *) echo 'No positional arguments expected.' >&2; exit 1 ;;
esac
source "$SCRIPT_DIR/install-dependencies.sh"
PROFILE="${PROFILE:-mk4}"
if [[ -z "${KUBE_CONTEXT:-}" ]]; then
  state="${MINIKUBE_HOME:-$HOME/.minikube}/roboshop-installer/$PROFILE.profile"
  [[ ! -f "$state" ]] || PROFILE="$(cat "$state")"
  KUBE_CONTEXT="$PROFILE"
fi
version="${ARGOCD_CHART_VERSION:-10.10.5}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid chart version.' >&2; exit 1; }
k() { kubectl --context="$KUBE_CONTEXT" --request-timeout=30s "$@"; }
k get ingressclass traefik >/dev/null
k get crd middlewares.traefik.io >/dev/null
[[ "$(k get clusterissuer letsencrypt-prod -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == True ]] || {
  echo 'Run bash minikube/deploy-cert-manager.sh first; letsencrypt-prod must be ready.' >&2; exit 1;
}
echo "Deploying Argo CD into context $KUBE_CONTEXT, namespace argocd."
k create namespace argocd --dry-run=client -o yaml | k apply -f -
helm upgrade --install argocd argo-cd --repo https://argoproj.github.io/argo-helm \
  --version "$version" --kube-context "$KUBE_CONTEXT" --namespace argocd \
  -f "$SCRIPT_DIR/argocd/values.yaml" --timeout 10m
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/setup-shared-tls.sh"
k apply -f "$SCRIPT_DIR/argocd/ingress.yaml"
echo 'Submitted: https://jithendar.com/argocd/ (pods and certificate may still be starting).'
echo 'Username: admin. After startup, retrieve the initial password with:'
printf 'kubectl --context=%q -n argocd get secret argocd-initial-admin-secret -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.password}' | base64 --decode; echo\n"
