#!/usr/bin/env bash
# Operations are opt-in; never changes kube context or prints credentials.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${PYTHON:-python3}" "$ROOT/scripts/openclaw/manage.py" "$@"
