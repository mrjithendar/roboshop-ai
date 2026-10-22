#!/usr/bin/env bash
# Reuse the ready WordPress certificate for all jithendar.com Traefik routes.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
export KUBE_CONTEXT=${KUBE_CONTEXT:-mk4}
python3 "$script_dir/shared-tls/configure.py"
