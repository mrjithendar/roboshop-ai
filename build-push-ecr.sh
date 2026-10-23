#!/usr/bin/env bash
# Compatibility entry point; implementation moved to scripts/build/build-push-ecr.sh.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)"
echo 'Deprecated path: use scripts/build/build-push-ecr.sh' >&2
exec bash "$ROOT/scripts/build/build-push-ecr.sh" "$@"
