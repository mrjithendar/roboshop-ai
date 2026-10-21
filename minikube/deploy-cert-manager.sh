#!/usr/bin/env bash
# Installs cert-manager and separate staging/production Let's Encrypt issuers.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
case "${1:-}" in
  -h|--help)
    echo 'Usage: bash minikube/deploy-cert-manager.sh'
    echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT, INGRESS_CLASS=traefik, LETSENCRYPT_EMAIL, CERT_MANAGER_VERSION=v1.20.4'
    echo 'Requires Helm, kubectl and a running cluster. Does not install ingress or request a site certificate.'
    exit 0 ;;
  '') ;;
  *) fail 'No positional arguments expected.' ;;
esac
[[ $# == 0 ]] || fail 'No positional arguments expected.'
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
for command in helm kubectl; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required. See minikube/cert-manager/README.md."
done
PROFILE="${PROFILE:-mk4}"
[[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid PROFILE.'
if [[ -z "${KUBE_CONTEXT:-}" ]]; then
  state="${MINIKUBE_HOME:-$HOME/.minikube}/roboshop-installer/$PROFILE.profile"
  if [[ -f "$state" ]]; then PROFILE="$(cat "$state")"; fi
  KUBE_CONTEXT="$PROFILE"
fi
[[ "$KUBE_CONTEXT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid KUBE_CONTEXT.'
INGRESS_CLASS="${INGRESS_CLASS:-traefik}"
[[ "$INGRESS_CLASS" =~ ^[a-z0-9][a-z0-9.-]*$ ]] || fail 'Invalid INGRESS_CLASS.'
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.20.4}"
[[ "$CERT_MANAGER_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid CERT_MANAGER_VERSION.'
ISSUER_ARGS=(--set-string "ingressClassName=$INGRESS_CLASS")
if [[ -n "${LETSENCRYPT_EMAIL:-}" ]]; then
  [[ "$LETSENCRYPT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'Invalid LETSENCRYPT_EMAIL.'
  ISSUER_ARGS+=(--set-string "email=$LETSENCRYPT_EMAIL")
fi
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
h() { helm --kube-context="$KUBE_CONTEXT" "$@"; }
echo "Installing cert-manager $CERT_MANAGER_VERSION into context $KUBE_CONTEXT."
k --request-timeout=15s get namespace kube-system >/dev/null
if ! k --request-timeout=15s get ingressclass "$INGRESS_CLASS" >/dev/null 2>&1; then
  echo "NOTE: IngressClass $INGRESS_CLASS was not found. Install that ingress controller before requesting a website certificate."
fi
h upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --version "$CERT_MANAGER_VERSION" --namespace cert-manager --create-namespace \
  -f "$SCRIPT_DIR/cert-manager/values.yaml" --wait --timeout 10m
k wait --for=condition=Established crd/clusterissuers.cert-manager.io crd/certificates.cert-manager.io --timeout=120s
h upgrade --install roboshop-letsencrypt "$SCRIPT_DIR/cert-manager/issuers" \
  --namespace cert-manager "${ISSUER_ARGS[@]}" --wait --timeout 5m
if ! k wait --for=condition=Ready clusterissuer/letsencrypt-staging clusterissuer/letsencrypt-prod --timeout=180s; then
  k describe clusterissuer letsencrypt-staging letsencrypt-prod
  fail 'ACME account initialization failed. Check issuer events, email and outbound HTTPS connectivity.'
fi
k get clusterissuer letsencrypt-staging letsencrypt-prod
echo 'cert-manager and Let’s Encrypt issuers are ready. No website certificate has been requested.'
echo 'Use letsencrypt-prod for trusted certificates; letsencrypt-staging for testing.'
echo 'Application installers manage their certificates: shared monitoring/certificate.yaml for Grafana + Prometheus; WordPress chart for WordPress.'
echo 'See minikube/monitoring/README.md for certificate ownership. The roboshop-ai certificate.example.yaml is a legacy/manual example only.'
