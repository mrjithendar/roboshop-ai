#!/usr/bin/env bash
# Add (or update) the Cloudflare R2 and Gemini settings in Secret jithendar/jithendar-com-env.
#   scripts/set-media-config.sh [kube-context]
# Prompts for each value (secrets are read silently and never printed), writes them with a patch file
# that only this user can read, and deletes it afterwards. Leave a prompt empty to keep the current value.
# Then restart the site: kubectl --context mk4 -n jithendar rollout restart deployment/jithendar-com
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

echo "Cloudflare R2 (dashboard → R2 → Manage API tokens; token scoped to the bucket, Object Read & Write)"
ask R2_ACCOUNT_ID "R2 account ID (32 hex characters)" plain
ask R2_BUCKET "R2 bucket name" plain
ask R2_ACCESS_KEY_ID "R2 access key ID" silent
ask R2_SECRET_ACCESS_KEY "R2 secret access key" silent
ask R2_PUBLIC_BASE_URL "Public media URL, e.g. https://media.jithendar.com (optional)" plain
echo
echo "Gemini image generation (aistudio.google.com → API keys). Leave both empty to keep it off."
ask GEMINI_API_KEY "Gemini API key" silent
ask GEMINI_IMAGE_MODEL "Image model code from ai.google.dev/gemini-api/docs/models (e.g. gemini-3.1-flash-image)" plain

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
