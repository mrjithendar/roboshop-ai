#!/usr/bin/env bash
# Repairs the service around an existing runner registration; it is not a token
# refresh or re-registration flow. Keep the runner directory and service identity
# aligned so repair cannot attach another repository's runner state.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" centos || exit 1
# Usage: bash runner/repair-service.sh --help
case "${1:-}" in --help|-h) echo 'Purpose: Repair existing service without fetching secrets or registering again.'; echo 'Usage: bash runner/repair-service.sh; see docs/operations/script-audit.md for prerequisites, variables and effects.'; exit 0;; esac
# Repair existing service without fetching secrets or registering again.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo or as root.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
runner_dir=${1:-/root/actions-runner}
runner_dir=$(cd -- "$runner_dir" && pwd -P)
[[ -f "$runner_dir/.service" ]] || { echo 'No installed runner service found.' >&2; exit 1; }
runner_service=$(cat "$runner_dir/.service")
[[ "$runner_service" == actions.runner.*.service && "$runner_service" != */* && "$runner_service" != *$'\n'* ]] || { echo 'Invalid runner service name.' >&2; exit 1; }
bash "$script_dir/fix-selinux.sh" "$runner_dir"
chmod u+x "$runner_dir/runsvc.sh"
systemctl reset-failed "$runner_service"
systemctl restart "$runner_service"
systemctl status "$runner_service" --no-pager -l
