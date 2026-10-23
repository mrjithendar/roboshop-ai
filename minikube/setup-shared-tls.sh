#!/usr/bin/env bash
# Reuses the managed site certificate instead of requesting one per dashboard.
# The Python helper owns the TLS resource checks; do not bypass source-certificate
# readiness merely to make an ingress apply succeed.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Usage: bash minikube/setup-shared-tls.sh --help
case "${1:-}" in --help|-h) echo 'Purpose: Reuse the ready WordPress certificate for all jithendar.com Traefik routes.'; echo 'Usage: bash minikube/setup-shared-tls.sh; see docs/operations/script-audit.md for prerequisites, variables and effects.'; exit 0;; esac
# Reuse the ready WordPress certificate for all jithendar.com Traefik routes.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
python3 "$script_dir/shared-tls/configure.py"
