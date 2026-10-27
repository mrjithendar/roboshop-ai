#!/usr/bin/env bash
# Pin the production image by digest. Usage: scripts/set-image.sh <image> <sha256:digest>
# Rewrites only the jithendar-com entry under `images:` in deploy/production/kustomization.yaml.
set -euo pipefail

IMAGE="$1"
DIGEST="$2"
FILE="$(dirname "$0")/../deploy/production/kustomization.yaml"

[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Invalid digest: $DIGEST" >&2; exit 1; }

awk -v image="$IMAGE" -v digest="$DIGEST" '
  /^- name: jithendar-com$/ { print; print "  newName: " image; print "  digest: " digest; skip = 1; found = 1; next }
  skip && /^  / { next }
  { skip = 0; print }
  END { if (!found) exit 2 }
' "$FILE" > "$FILE.tmp" || { rm -f "$FILE.tmp"; echo "No jithendar-com image entry in $FILE" >&2; exit 1; }
mv "$FILE.tmp" "$FILE"
