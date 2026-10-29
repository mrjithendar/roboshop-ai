#!/usr/bin/env bash
# Add (or update) Google / GitHub sign-in credentials in Secret jithendar/jithendar-com-env.
#   scripts/set-oauth-config.sh [kube-context]
# Prompts for each value (secrets are read silently and never printed), writes them with a patch file
# that only this user can read, and deletes it afterwards. Leave a prompt empty to keep the current value.
# A provider's button appears only when both its client ID and secret are set. See docs/AUTH.md.
set -euo pipefail

CONTEXT="${1:-mk4}"
NS="jithendar"
SECRET="jithendar-com-env"
kubectl --context "$CONTEXT" -n "$NS" get secret "$SECRET" >/dev/null || { echo "Secret $NS/$SECRET is missing; run scripts/create-secrets.sh first." >&2; exit 1; }

declare -a KEYS=()
declare -a VALUES=()
ask() { # name prompt silent
  local v
  if [[ "$3" == "silent" ]]; then read -r -s -p "$2: " v; echo; else read -r -p "$2: " v; fi
  if [[ -n "$v" ]]; then KEYS+=("$1"); VALUES+=("$v"); fi
}

echo "Google (console.cloud.google.com → Google Auth Platform → Clients; redirect URI https://jithendar.com/api/auth/callback/google)"
ask GOOGLE_CLIENT_ID "Google client ID" plain
ask GOOGLE_CLIENT_SECRET "Google client secret" silent
echo
echo "GitHub (github.com/settings/developers → OAuth Apps; callback URL https://jithendar.com/api/auth/callback/github)"
ask GITHUB_CLIENT_ID "GitHub client ID" plain
ask GITHUB_CLIENT_SECRET "GitHub client secret" silent

[[ ${#KEYS[@]} -gt 0 ]] || { echo "Nothing to change."; exit 0; }

umask 077
patch="$(mktemp)"
trap 'rm -f "$patch"' EXIT
{
  printf '{"stringData":{'
  for i in "${!KEYS[@]}"; do
    [[ $i -gt 0 ]] && printf ','
    # JSON-escape backslashes and quotes.
    v="${VALUES[$i]//\\/\\\\}"; v="${v//\"/\\\"}"
    printf '"%s":"%s"' "${KEYS[$i]}" "$v"
  done
  printf '}}'
} > "$patch"
kubectl --context "$CONTEXT" -n "$NS" patch secret "$SECRET" --type merge --patch-file "$patch" >/dev/null
echo "Updated ${KEYS[*]} in $NS/$SECRET (values not shown)."
echo "Restart to apply: kubectl --context $CONTEXT -n $NS rollout restart deployment/jithendar-com"
