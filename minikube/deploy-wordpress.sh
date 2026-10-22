#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/deploy-wordpress.sh'
  echo 'Overrides: PROFILE=mk4, KUBE_CONTEXT. Configuration: minikube/wordpress/values.yaml'
  exit 0
fi
[[ $# == 0 ]] || fail 'No positional arguments expected.'
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
source "$SCRIPT_DIR/install-dependencies.sh"
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
echo "Deploying WordPress to https://jithendar.com in namespace jithendar using context $KUBE_CONTEXT."
k --request-timeout=15s get namespace kube-system >/dev/null
k get ingressclass traefik >/dev/null || fail 'Run deploy-traefik.sh and expose-ingress.sh first.'
k wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s || fail 'Run deploy-cert-manager.sh first.'
# Namespace changes do not move PVCs or database contents. Never hide an old site.
legacy="$(k -n roboshop-ai get pvc wordpress-mysql wordpress-wordpress --ignore-not-found -o name)"
[[ -z "$legacy" ]] || fail 'Existing WordPress data found in roboshop-ai. Back up and migrate the database, site files and credentials to jithendar before deploying. See minikube/wordpress/README.md. No data was changed.'
k get ingress --all-namespaces -o json | python3 "$SCRIPT_DIR/wordpress/check-routes.py"
k create namespace jithendar --dry-run=client -o yaml | k apply -f -
existing="$(k -n jithendar get secret wordpress-credentials --ignore-not-found -o name)"
if [[ -z "$existing" ]]; then
  claims="$(k -n jithendar get pvc wordpress-mysql wordpress-wordpress --ignore-not-found -o name)"
  [[ -z "$claims" ]] || fail 'WordPress data exists but its credentials are missing. Restore wordpress-credentials from backup; passwords will not be regenerated over existing data.'
  temp="$(mktemp -d)"
  trap 'rm -rf "$temp"' EXIT
  # Generate independent strong passwords locally; never print or commit them.
  python3 - "$temp/secret.json" <<'PYSECRET'
import json, secrets, sys, os
payload = {'apiVersion':'v1','kind':'Secret',
           'metadata':{'name':'wordpress-credentials','namespace':'jithendar'},
           'type':'Opaque', 'stringData':{key:secrets.token_hex(32) for key in
             ('database-password','database-root-password','redis-password','admin-password')}}
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump(payload, file)
PYSECRET
  k create -f "$temp/secret.json"
  rm -rf "$temp"
  trap - EXIT
fi
# Preserve the current route on upgrades; fresh installs stay private until initialized.
route="$(k -n jithendar get ingress wordpress --ignore-not-found -o name)"
enabled=false
[[ -z "$route" ]] || enabled=true
h upgrade --install wordpress "$SCRIPT_DIR/wordpress" --namespace jithendar \
  --set "ingress.enabled=$enabled" --wait --timeout 10m
k -n jithendar exec -i deployment/wordpress -c cli -- sh -s < "$SCRIPT_DIR/wordpress/bootstrap.sh"
k -n jithendar wait --for=condition=Ready certificate/jithendar-com --timeout=10m
KUBE_CONTEXT="$KUBE_CONTEXT" bash "$SCRIPT_DIR/setup-shared-tls.sh"
# Publish only after installation and the cross-process Redis check succeed.
h upgrade --install wordpress "$SCRIPT_DIR/wordpress" --namespace jithendar \
  --set ingress.enabled=true --wait --timeout 10m
echo 'WordPress initialized and Redis cache verified. Site: https://jithendar.com/'
echo 'Admin login: https://jithendar.com/wp-admin/ (default user: admin).'
echo 'Retrieve the initial password using:'
printf 'kubectl --context=%q -n jithendar get secret wordpress-credentials -o jsonpath=' "$KUBE_CONTEXT"
printf "'{.data.admin-password}' | base64 --decode; echo\n"
echo 'Grafana remains at https://jithendar.com/grafana/. See minikube/wordpress/README.md.'
