#!/usr/bin/env bash
# Mint a kubeconfig for the CI deployer and store it as the GitHub environment secret
# JITHENDAR_KUBECONFIG (environment "production"). Run as an admin; re-run to rotate.
# Usage: scripts/ci-kubeconfig.sh [kube-context] [token-duration]
set -euo pipefail

CONTEXT="${1:-mk4}"
DURATION="${2:-8760h}"
REPO="mrjithendar/roboshop-ai"
NAMESPACE="jithendar"
SA="jithendar-deployer"

cluster="$(kubectl config view --raw --minify --context "$CONTEXT" -o jsonpath='{.clusters[0].cluster}')"
server="$(jq -r '.server' <<<"$cluster")"
ca="$(jq -r '."certificate-authority-data" // empty' <<<"$cluster")"
tls_name="$(jq -r '."tls-server-name" // empty' <<<"$cluster")"
[[ -n "$ca" ]] || { echo "Context $CONTEXT has no embedded CA data." >&2; exit 1; }

token="$(kubectl --context "$CONTEXT" -n "$NAMESPACE" create token "$SA" --duration "$DURATION")"

kubeconfig="$(cat <<YAML
apiVersion: v1
kind: Config
clusters:
- name: mk4
  cluster:
    server: ${server}
    certificate-authority-data: ${ca}
$( [[ -n "$tls_name" ]] && echo "    tls-server-name: ${tls_name}" )
users:
- name: ${SA}
  user:
    token: ${token}
contexts:
- name: jithendar-deployer
  context:
    cluster: mk4
    user: ${SA}
    namespace: ${NAMESPACE}
current-context: jithendar-deployer
YAML
)"

# Prove the credential works and is scoped before storing it.
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$kubeconfig" > "$tmp"
KUBECONFIG="$tmp" kubectl auth can-i patch deployments -n "$NAMESPACE" >/dev/null || { echo "Token cannot patch deployments in $NAMESPACE." >&2; exit 1; }
if KUBECONFIG="$tmp" kubectl auth can-i get secrets -n "$NAMESPACE" >/dev/null 2>&1; then
  echo "Token can read Secrets; refusing to store an over-privileged credential." >&2; exit 1
fi

printf '%s\n' "$kubeconfig" | gh secret set JITHENDAR_KUBECONFIG --repo "$REPO" --env production
expiry="$(jq -R 'split(".")[1] | gsub("-";"+") | gsub("_";"/") | @base64d | fromjson | .exp | todate' <<<"$token" 2>/dev/null || echo unknown)"
echo "Stored JITHENDAR_KUBECONFIG for environment production (token expires: ${expiry}). Re-run before then to rotate."
