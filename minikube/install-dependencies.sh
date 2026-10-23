#!/usr/bin/env bash
# This file is sourced by deployments, so it must not install packages or edit
# PATH. A missing/broken CLI stops deployment and points to explicit setup.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Compatibility prerequisite check, sourced by deployment scripts. Never installs.
# Usage: bash minikube/install-dependencies.sh [--help]
if [[ "${1:-}" == --help ]]; then
  echo 'Checks Helm, kubectl and Python. Install prerequisites with ./init.sh --profile minikube.'
  return 0 2>/dev/null || exit 0
fi
install_deployment_dependencies() (
  set -euo pipefail
  for tool in helm kubectl python3; do
    command -v "$tool" >/dev/null || { echo "ERROR: $tool missing; run ./init.sh --profile minikube." >&2; exit 1; }
  done
  helm version --short | grep -Eq '^v[34]\.' || { echo 'ERROR: Kubernetes Helm 3/4 required; select a compatible installation in PATH.' >&2; exit 1; }
  kubectl version --client -o json >/dev/null
  python3 -c 'import sys; assert sys.version_info >= (3, 9)'
)
install_deployment_dependencies
