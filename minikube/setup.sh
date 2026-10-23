#!/usr/bin/env bash
# Compatibility entry point for older runbooks. Default behavior only prepares
# host prerequisites. --start explicitly requests cluster creation afterwards;
# separating these steps prevents setup from unexpectedly changing workloads.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Compatibility host setup. Initialization is separate from cluster creation.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  --help|-h) echo 'Usage: minikube/setup.sh [--install-only|--start]'; echo 'Default installs prerequisites only. --start explicitly starts the cluster afterwards.'; exit 0;;
  ''|--install-only|--start) ;;
  *) echo 'Unknown argument; use --help.' >&2; exit 2;;
esac
[[ $# -le 1 ]] || exit 2
bash "$ROOT/init.sh" --profile minikube
if [[ "${1:-}" == --start ]]; then exec bash "$ROOT/minikube/install.sh" start; fi
