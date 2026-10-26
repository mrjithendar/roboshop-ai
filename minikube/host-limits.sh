#!/usr/bin/env bash
# Docker-backed nodes share the host kernel. Increasing inotify capacity is a
# host-wide change, not a per-pod setting; inspect the proposed values and keep
# this operation separate from ordinary application deployment.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" linux || exit 1
# ELK mmap tuning is deliberately opt-in; ordinary Minikube start never applies it.
if [[ "${1:-}" == --elk ]]; then
  set -euo pipefail
  mode="${2:---check}"
  case "$mode" in --check|--dry-run|--apply) ;; *) echo 'Usage: host-limits.sh --elk [--check|--dry-run|--apply]' >&2; exit 2;; esac
  [[ $# -le 2 ]] || exit 2
  current=$(sysctl -n vm.max_map_count)
  [[ "$current" =~ ^[0-9]+$ ]] || exit 1
  if (( current >= 1048576 )); then echo 'Elasticsearch mmap limit sufficient.'; exit 0; fi
  if [[ "$mode" != --apply ]]; then
    echo "vm.max_map_count=$current; ELK recommends 1048576. Use --elk --apply explicitly on the Minikube Linux host."
    [[ "$mode" == --dry-run ]] && exit 0 || exit 1
  fi
  ADMIN=(); [[ "$EUID" == 0 ]] || ADMIN=(sudo)
  file=/etc/sysctl.d/99-roboshop-elk.conf
  if [[ -f "$file" ]] && [[ ! "$(cat "$file")" =~ ^vm.max_map_count=[0-9]+$ ]]; then
    echo 'Existing sysctl file is not recognized; preserve and review it manually.' >&2; exit 1
  fi
  config=$(mktemp); trap 'rm -f "$config"' EXIT
  printf 'vm.max_map_count=1048576\n' > "$config"
  "${ADMIN[@]}" install -m 0644 "$config" "$file"
  "${ADMIN[@]}" sysctl -p "$file"
  exit 0
fi

# Usage: bash minikube/host-limits.sh --help
case "${1:-}" in --help|-h) echo 'ELK only: --elk --check|--dry-run|--apply (explicit mmap tuning).'; echo 'Purpose: Docker-backed nodes share the Linux hosts inotify resources. Run on that host.'; echo 'Usage: bash minikube/host-limits.sh; see docs/operations/script-audit.md for prerequisites, variables and effects.'; exit 0;; esac
# Docker-backed nodes share the Linux host's inotify resources. Run on that host.
set -euo pipefail
[[ $(uname -s) == Linux ]] || exit 0
fail() { echo "ERROR: $*" >&2; exit 1; }
command -v sysctl >/dev/null || fail 'sysctl is required (install procps/procps-ng).'
instances=$(sysctl -n fs.inotify.max_user_instances)
watches=$(sysctl -n fs.inotify.max_user_watches)
for value in "$instances" "$watches"; do
  [[ $value =~ ^[0-9]{1,10}$ ]] || fail 'Could not read valid host inotify limits.'
done
instances=$((10#$instances)); watches=$((10#$watches))
if (( instances >= 1024 && watches >= 1048576 )); then
  echo "Host inotify limits sufficient: instances=$instances watches=$watches"
  exit 0
fi
ADMIN=()
if [[ $EUID != 0 ]]; then
  command -v sudo >/dev/null || fail 'Rerun host-limits.sh as root to raise host inotify limits.'
  ADMIN=(sudo)
fi
# Never reduce higher existing values. Apply only this file, not unrelated sysctls.
config=$(mktemp)
trap 'rm -f "$config"' EXIT
printf 'fs.inotify.max_user_instances=%s\nfs.inotify.max_user_watches=%s\n' \
  "$((instances > 1024 ? instances : 1024))" \
  "$((watches > 1048576 ? watches : 1048576))" > "$config"
echo 'Raising host inotify limits to prevent fsnotify startup failures (sudo needed for non-root users).'
"${ADMIN[@]}" install -d -m 0755 /etc/sysctl.d
"${ADMIN[@]}" install -m 0644 "$config" /etc/sysctl.d/99-minikube-inotify.conf
"${ADMIN[@]}" sysctl -p /etc/sysctl.d/99-minikube-inotify.conf
(( $(sysctl -n fs.inotify.max_user_instances) >= 1024 && $(sysctl -n fs.inotify.max_user_watches) >= 1048576 )) || fail 'Host inotify limits did not take effect; cluster startup stopped.'
