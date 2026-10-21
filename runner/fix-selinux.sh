#!/usr/bin/env bash
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
  if command -v dnf >/dev/null; then
    dnf install -y policycoreutils-python-utils
  elif command -v yum >/dev/null; then
    yum install -y policycoreutils-python-utils
  elif command -v apt-get >/dev/null; then
    apt-get update
    apt-get install -y policycoreutils-python-utils
  elif command -v zypper >/dev/null; then
    zypper --non-interactive install policycoreutils-python-utils
  else
    echo 'Install semanage (policycoreutils-python-utils) and rerun.' >&2
    exit 1
  fi
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
