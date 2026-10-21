#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

[[ $(uname -s) == Linux ]] || { echo 'This installer requires Linux.' >&2; exit 1; }

# GitHub's config.sh requires this explicit opt-in when configuring as root.
if [[ $EUID == 0 ]]; then
  export RUNNER_ALLOW_RUNASROOT=1
  as_root() { "$@"; }
else
  command -v sudo >/dev/null || { echo 'Install sudo or run setup from a root account.' >&2; exit 1; }
  sudo -v
  as_root() { sudo "$@"; }
fi
[[ -d /run/systemd/system ]] || { echo 'A running systemd host is required (not Alpine/OpenRC or a plain container).' >&2; exit 1; }
case $(uname -m) in x86_64|aarch64|arm64) ;; *) echo 'Supported architectures: x86_64 and arm64.' >&2; exit 1;; esac
source /etc/os-release
# Install prerequisites before checking for commands on minimal server images.
if command -v apt-get >/dev/null; then
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl tar gzip coreutils util-linux python3 python3-venv git
elif command -v dnf >/dev/null || command -v yum >/dev/null; then
  package_manager=dnf
  command -v dnf >/dev/null || package_manager=yum
  as_root "$package_manager" install -y ca-certificates tar gzip coreutils util-linux python3 python3-pip git libicu openssl-libs krb5-libs zlib libstdc++ libgcc
  # Keep curl-minimal where installed, avoiding RPM package conflicts.
  command -v curl >/dev/null || as_root "$package_manager" install -y curl
elif command -v zypper >/dev/null; then
  as_root zypper --non-interactive install ca-certificates curl tar gzip coreutils util-linux python3 python3-pip git libicu libopenssl3 libkrb5-3 libz1 libstdc++6 libgcc_s1
else
  echo "No supported package manager found on ${ID:-unknown}; supported: apt, dnf/yum, zypper." >&2
  exit 1
fi
for command in python3 curl tar sha256sum flock; do
  command -v "$command" >/dev/null || { echo "Missing prerequisite after installation: $command" >&2; exit 1; }
done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else "Python 3.9+ required; upgrade this Linux release.")'

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
runner_dir=${RUNNER_DIR:-"$HOME/actions-runner"}
mkdir -p -- "$runner_dir" || {
  echo 'Cannot create runner directory. Set RUNNER_DIR to a directory writable by your user.' >&2
  exit 1
}
[[ -w "$runner_dir" ]] || { echo "Runner directory is not writable: $runner_dir" >&2; exit 1; }
cd -- "$runner_dir"
runner_dir=$(pwd -P)
exec 9>.setup.lock
flock -n 9 || { echo 'Another runner installation is running.' >&2; exit 1; }

repo=${1:-mrjithendar/roboshop-ai}
export RUNNER_SECRET_NAME=${2:-roboshop-ai}
export AWS_REGION=${3:-us-east-1}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Repository must be OWNER/REPOSITORY.' >&2; exit 1; }
# Reuse AWS CLI if available; otherwise isolate it from system Python packages.
if [[ ! -f .runner ]] && ! command -v aws >/dev/null; then
  python3 -m venv .setup-tools
  .setup-tools/bin/python -m pip install --disable-pip-version-check 'awscli>=1.32,<2'
  export PATH="$runner_dir/.setup-tools/bin:$PATH"
fi
export AWS_PAGER=""

if [[ ! -f .runner ]]; then
  case $(uname -m) in
    x86_64) arch=x64; checksum=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613;;
    aarch64|arm64) arch=arm64; checksum=9b1dc70626422526e3c94767cf024896beb15da5342a3f4819bf2feac13e0393;;
    *) echo 'Supported architectures: x86_64 and arm64.' >&2; exit 1;;
  esac
  archive=$(mktemp)
  trap 'rm -f -- "$archive"' EXIT
  curl --fail --location --retry 3 --connect-timeout 15 \
    "https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-$arch-2.337.0.tar.gz" -o "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  tar --no-same-owner -xzf "$archive"
  rm -f -- "$archive"
  trap - EXIT
  # RPM/SUSE runtime libraries were installed above; Debian/Ubuntu package
  # names vary by release, so use the runner's own dependency detection there.
  if command -v apt-get >/dev/null; then
    as_root bash ./bin/installdependencies.sh
  fi
  # Fail before fetching credentials if the runner runtime cannot start.
  ./config.sh --version
  # AWS is called as the invoking user, retaining their AWS profile/credentials.
  python3 "$script_dir/register.py" "$repo" "${RUNNER_NAME:-$(hostname)}"
else
  python3 - "$repo" <<'PY'
import json, sys
from pathlib import Path
if json.loads(Path('.runner').read_text(encoding='utf-8-sig')).get('gitHubUrl', '').rstrip('/').lower() != ('https://github.com/' + sys.argv[1]).lower():
    raise SystemExit('Existing runner belongs to another repository; use a different RUNNER_DIR.')
PY
  echo 'Runner already configured; ensuring its service is running.'
fi

if [[ ! -f .service ]]; then
  as_root ./svc.sh install "$(id -un)"
fi

as_root bash "$script_dir/fix-selinux.sh" "$runner_dir"
as_root ./svc.sh start
as_root ./svc.sh status
