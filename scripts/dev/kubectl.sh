#!/usr/bin/env bash
# Uses KUBECONFIG when explicitly supplied; otherwise selects the downloaded
# cluster config. All kubectl arguments pass through unchanged, so this helper
# can perform writes or deletes as well as read-only inspection.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Run kubectl against the downloaded Vultr config without a manual export.
set -eu
case "${1:-}" in --help|-h) echo 'Usage: scripts/dev/kubectl.sh KUBECTL_ARGS'; echo 'Requires kubectl (init minikube). KUBECONFIG overrides ~/.kube/vultr-minikube.json. Arguments may mutate the cluster.'; exit 0;; esac
if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG="$HOME/.kube/vultr-minikube.json"
  if [ ! -r "$KUBECONFIG" ]; then
    echo "ERROR: $KUBECONFIG is missing or unreadable. Run bash minikube/kubeconfig.sh first, or set KUBECONFIG explicitly." >&2
    exit 1
  fi
  export KUBECONFIG
fi
command -v kubectl >/dev/null 2>&1 || { echo 'ERROR: kubectl is required.' >&2; exit 1; }
exec kubectl "$@"
