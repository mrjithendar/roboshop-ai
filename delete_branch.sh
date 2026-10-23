#!/usr/bin/env bash
# Compatibility entry point; implementation moved to scripts/maintenance/delete-branches.sh.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)"
echo 'Deprecated path: use scripts/maintenance/delete-branches.sh' >&2
exec bash "$ROOT/scripts/maintenance/delete-branches.sh" "$@"
