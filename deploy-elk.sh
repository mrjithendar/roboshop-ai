#!/usr/bin/env bash
# One command for the ordered Argo-managed ELK installation. Paths are anchored
# here so invoking this wrapper from another directory works too.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
args=()
apply=(--apply)
for arg in "$@"; do
  if [[ "$arg" == --dry-run ]]; then apply=(); else args+=("$arg"); fi
done
exec "${PYTHON:-python3}" "$ROOT/scripts/observability/elk.py" deploy "${apply[@]}" "${args[@]}"
