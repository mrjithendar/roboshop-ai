#!/usr/bin/env bash
# Argo reads published Git manifests. Existing Grafana and Loki storage are reused.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/deploy-argocd.sh" loki grafana "$@"
