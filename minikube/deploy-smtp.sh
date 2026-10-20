#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/deploy-smtp.sh [--check]'
  echo 'Run on the Minikube host after building robotshop-smtp-server:local.'
  echo 'Uses current kubeconfig; KUBE_CONTEXT and PROFILE may override the current context/profile.'
  exit 0
fi
[[ $# == 0 || ( $# == 1 && "$1" == --check ) ]] || { echo 'Unknown argument.' >&2; exit 2; }
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
if [[ -z "${KUBECONFIG:-}" && -f "$HOME/.kube/vultr-minikube.json" ]]; then export KUBECONFIG="$HOME/.kube/vultr-minikube.json"; fi
for tool in kubectl openssl python3; do command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }; done
KUBE_CONTEXT="${KUBE_CONTEXT:-$(kubectl config current-context)}"
k() { kubectl --context="$KUBE_CONTEXT" "$@"; }
k --request-timeout=15s get namespace robotshop-ai >/dev/null
k --request-timeout=15s get crd certificates.cert-manager.io >/dev/null
if [[ "${1:-}" == --check ]]; then
  echo "Cluster $KUBE_CONTEXT is reachable and cert-manager is installed. No resources changed."
  echo 'Direct delivery additionally requires outbound TCP 25, mail.jithendar.com A/PTR, SPF, DKIM and DMARC.'
  exit 0
fi
command -v minikube >/dev/null || { echo 'Run deployment on the Minikube host (minikube is required to load the image).' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker is required on the Minikube host.' >&2; exit 1; }
docker image inspect robotshop-smtp-server:local >/dev/null
PROFILE="${PROFILE:-$KUBE_CONTEXT}"
minikube -p "$PROFILE" image load --overwrite=true robotshop-smtp-server:local
k apply -f "$ROOT/services/smtp-server/certificates.yaml"
k -n robotshop-ai wait --for=condition=Ready certificate/smtp-ca --timeout=120s
k -n robotshop-ai wait --for=condition=Ready certificate/smtp-server-tls certificate/smtp-client-tls --timeout=120s
python3 "$ROOT/services/smtp-server/configure.py" --context "$KUBE_CONTEXT"
k apply -f "$ROOT/services/smtp-server/smtp-server-minikube.yaml"
k -n robotshop-ai rollout restart deployment/smtp-server
k -n robotshop-ai rollout status deployment/smtp-server --timeout=180s
# Do not apply the gateway manifest here: it must use the newly built gateway image.
echo 'SMTP is installed. Build and deploy the updated user-service, ai-gateway and frontend next (see services/smtp-server/README.md).'
echo 'Inbox delivery is not yet verified. Publish the printed DKIM record and complete the mail DNS/port checks.'
