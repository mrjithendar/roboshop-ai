#!/usr/bin/env bash
# Compatibility entry point; implementation moved to scripts/deploy/deploy-minikube.sh.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)"
echo 'Deprecated path: use scripts/deploy/deploy-minikube.sh' >&2
exec bash "$ROOT/scripts/deploy/deploy-minikube.sh" "$@"
