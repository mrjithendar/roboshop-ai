#!/usr/bin/env sh
# Run kubectl against the downloaded Vultr config without a manual export.
set -eu
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
