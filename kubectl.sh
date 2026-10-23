#!/usr/bin/env bash
# Compatibility entry point; implementation moved to scripts/dev/kubectl.sh.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)"
echo 'Deprecated path: use scripts/dev/kubectl.sh' >&2
exec bash "$ROOT/scripts/dev/kubectl.sh" "$@"
