#!/usr/bin/env bash
# Uses persistent file-context rules for a validated runner directory. Relabeling
# that directory addresses execution permissions without disabling SELinux or
# broadly changing unrelated filesystem labels.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
# Usage: bash runner/fix-selinux.sh --help
case "${1:-}" in --help|-h) echo 'Purpose: Label only a validated runner installation; never disable SELinux.'; echo 'Usage: bash runner/fix-selinux.sh; see docs/operations/script-audit.md for prerequisites, variables and effects.'; exit 0;; esac
# Label only a validated runner installation; never disable SELinux.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo or as root.' >&2; exit 1; }
runner_dir=${1:?Usage: fix-selinux.sh RUNNER_DIRECTORY}
runner_dir=$(cd -- "$runner_dir" && pwd -P)
[[ "$runner_dir" != / && -f "$runner_dir/.runner" && -f "$runner_dir/runsvc.sh" && -d "$runner_dir/bin" && -d "$runner_dir/externals" ]] || {
  echo 'Expected a configured GitHub runner directory with an installed service.' >&2; exit 1;
}
if ! command -v getenforce >/dev/null || [[ $(getenforce) == Disabled ]]; then
  echo 'SELinux is disabled or unavailable; no labeling needed.'
  exit 0
fi
if ! command -v semanage >/dev/null; then
  dnf install -y policycoreutils-python-utils
fi
# Escape filesystem names as regexes; update our existing rule on reruns.
python3 - "$runner_dir" <<'PY'
import os, re, subprocess, sys
pattern = re.escape(sys.argv[1]) + r'(/.*)?'
env = dict(os.environ, LC_ALL='C')
rules = subprocess.check_output(['semanage', 'fcontext', '-l'], text=True, env=env)
exists = any(line.startswith(pattern) and line[len(pattern):len(pattern)+1].isspace()
             for line in rules.splitlines())
subprocess.run(['semanage', 'fcontext', '-m' if exists else '-a', '-t', 'bin_t', pattern], check=True, env=env)
PY
restorecon -RF "$runner_dir"
echo "Persistent SELinux runner context applied to $runner_dir."
