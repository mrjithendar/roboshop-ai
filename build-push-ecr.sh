#!/usr/bin/env bash
# Compatibility entry point; implementation moved to scripts/images/build-push-ecr.sh.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)"
echo 'Deprecated path: use scripts/images/build-push-ecr.sh' >&2
exec bash "$ROOT/scripts/images/build-push-ecr.sh" "$@"
