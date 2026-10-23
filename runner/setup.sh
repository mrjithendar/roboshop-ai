#!/usr/bin/env bash
# Explicit runner registration/service setup, not part of host initialization.
# RUNNER_DIR owns registration state and private tool paths. Existing registration
# must match the requested repository; fetching a new token must not silently
# replace a healthy runner. Never trace commands that handle registration secrets.

# CentOS host prerequisite; reject other OSes before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
set +x
set -euo pipefail
umask 077
case "${1:-}" in --help|-h) echo 'Usage: runner/setup.sh [OWNER/REPO [AWS_SECRET_NAME [AWS_REGION]]]'; echo 'Prerequisites: init dev + aws, systemd Linux. Registers runner, reads AWS secret, installs runner OS libraries and starts its service. RUNNER_DIR selects installation.'; exit 0;; esac

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
# Package queries avoid network/package transactions when prerequisites exist.
install_missing() {
  local package
  local missing=()
  for package in "$@"; do
    if command -v dpkg-query >/dev/null; then
      [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]] || missing+=("$package")
    else
      rpm -q "$package" >/dev/null 2>&1 || missing+=("$package")
    fi
  done
  if (( ${#missing[@]} == 0 )); then return; fi
  case "$package_manager" in
    *) as_root "$package_manager" install -y "${missing[@]}" ;;
  esac
}
package_manager=dnf
install_missing ca-certificates tar gzip coreutils util-linux python3 python3-pip unzip git libicu openssl-libs krb5-libs zlib libstdc++ libgcc
command -v curl >/dev/null || as_root dnf install -y curl
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
export RUNNER_SECRET_NAME=${2:-${RUNNER_SECRET_NAME:-mrjithendar-github-pat}}
export AWS_REGION=${3:-us-east-1}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Repository must be OWNER/REPOSITORY.' >&2; exit 1; }
# Check tools on every setup; install only missing or broken private tools.
# Do not replace interpreters while a runner service may be executing a job.
if [[ -f .service ]]; then
  runner_service=$(cat .service)
  if systemctl is-active --quiet "$runner_service"; then
    echo 'Runner service is active. Wait until it is Idle, then run sudo ./svc.sh stop from the runner directory and rerun setup.' >&2
    exit 1
  fi
fi
bash "$script_dir/install-tools.sh" "$runner_dir"
export PATH="$runner_dir/.tools/python/bin:$runner_dir/.tools/bin:$PATH"
# The runner loads .path at service startup; shell-only PATH changes are insufficient.
printf '%s\n' "$PATH" > .path
python3 --version
python3 -m pip --version
aws --version

export AWS_PAGER=""

if [[ ! -f .runner ]]; then
  if [[ -x ./config.sh && -x ./bin/Runner.Listener && -f ./svc.sh ]] && ./config.sh --version >/dev/null 2>&1; then
    echo 'Reusing installed runner files; retrying registration.'
  else
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

    # Fail before fetching credentials if the runner runtime cannot start.
    ./config.sh --version
  fi
  # AWS is called as the invoking user, retaining their AWS profile/credentials.
  if python3 "$script_dir/register.py" "$repo" "${RUNNER_NAME:-$(hostname)}"; then
    :
  else
    registration_status=$?
    if [[ "$registration_status" == 75 ]]; then
      echo 'Tools and runner files installed. GitHub registration is pending because the AWS secret could not be retrieved.'
      echo 'No runner service was installed or started. Use RUNNER_AUTH=github with gh auth login or GH_TOKEN, or restore AWS secret access, then rerun.'
      printf 'AWS configuration command: %q configure\n' "$runner_dir/.tools/bin/aws"
      exit 0
    fi
    exit "$registration_status"
  fi
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
