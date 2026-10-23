#!/usr/bin/env bash
# Entry point: validate options and the CentOS host before installing anything.
# Only a missing bootstrap Python is installed here; profile decisions live in
# scripts/setup/initialize.py. Forwarding the original argument array preserves
# quoted values and the child process exit code.

# Initialize host prerequisites only. Usage: ./init.sh --help
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Help must work even on a machine without Python.
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  cat "$ROOT/scripts/setup/help.txt"
  exit 0
fi
ORIGINAL_ARGS=("$@")
PROFILE=dev
READ_ONLY=0
while (( $# )); do
  case "$1" in
    --profile) [[ $# -ge 2 ]] || { echo 'Missing profile' >&2; exit 2; }; PROFILE="$2"; shift 2 ;;
    --help|-h) cat "$ROOT/scripts/setup/help.txt"; exit 0 ;;
    --check|--dry-run) READ_ONLY=1; shift ;;
    *) echo 'Unknown argument; use --help.' >&2; exit 2 ;;
  esac
done
case "$PROFILE" in dev|docker|minikube|aws) ;; *) echo 'Unknown profile' >&2; exit 2;; esac
source "$ROOT/scripts/lib/require-centos.sh"
roboshop_require_centos
if ! command -v python3 >/dev/null; then
  if [[ "$READ_ONLY" == 1 ]]; then
    echo 'Python 3.9+ missing; normal init installs it using dnf. No changes made.' >&2
    exit 1
  fi
  ADMIN=()
  if [[ "$EUID" != 0 ]]; then ADMIN=(sudo); fi
  "${ADMIN[@]}" dnf install -y python3
fi
exec python3 "$ROOT/scripts/setup/initialize.py" "${ORIGINAL_ARGS[@]}"
