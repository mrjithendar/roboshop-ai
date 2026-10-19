#!/usr/bin/env bash
# CentOS host setup; root sessions bootstrap a regular Minikube user.
set -euo pipefail
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/setup-centos.sh [--start]'
  echo 'Root creates MINIKUBE_USER (default robotshop), installs tools as that user, and optionally starts the cluster.'
  echo 'Installs Docker prerequisites (sudo for non-root), enables Docker, and configures the target user.'
  exit 0
fi
START=0
if [[ $# == 1 && "$1" == --start ]]; then START=1; elif [[ $# != 0 ]]; then fail 'Expected --start or no arguments.'; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/install.sh" ]] || fail 'Keep install.sh beside setup-centos.sh.'
[[ "$(uname -s)" == Linux && -r /etc/os-release ]] || fail 'This setup requires CentOS Stream 9 or 10.'
. /etc/os-release
[[ "${ID:-}" == centos && "${NAME:-}" == *Stream* ]] || fail 'This setup requires CentOS Stream 9 or 10.'
case "${VERSION_ID:-}" in 9|10) ;; *) fail 'Use CentOS Stream 9 or 10; older CentOS releases are unsupported.' ;; esac
case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) fail 'Supported architectures: amd64 and arm64.' ;; esac
ADMIN=()
if [[ "$EUID" == 0 ]]; then
  TARGET_USER="${MINIKUBE_USER:-${SUDO_USER:-robotshop}}"
  [[ "$TARGET_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$TARGET_USER" != root ]] || fail 'MINIKUBE_USER must name a regular user.'
  if id "$TARGET_USER" >/dev/null 2>&1; then
    [[ "$(id -u "$TARGET_USER")" -ge 1000 ]] || fail 'Choose a regular user with UID >= 1000.'
  fi
else
  command -v sudo >/dev/null || fail 'Ask your administrator to configure sudo for your user.'
  ADMIN=(sudo)
  TARGET_USER="$(id -un)"
fi
# Do not silently erase an existing container runtime or conflicting packages.
for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman-docker; do
  if rpm -q "$package" >/dev/null 2>&1; then
    fail "Conflicting package $package is installed. Review https://docs.docker.com/engine/install/centos/ before replacing it."
  fi
done
echo 'Installing Docker Engine and enabling it at boot. Docker group membership grants root-level host access.'
"${ADMIN[@]}" dnf install -y ca-certificates coreutils dnf-plugins-core shadow-utils util-linux
# curl-minimal, supplied by some cloud images, is sufficient.
command -v curl >/dev/null 2>&1 || "${ADMIN[@]}" dnf install -y curl
"${ADMIN[@]}" dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
echo 'Verify the Docker signing key against https://docs.docker.com/engine/install/centos/ if prompted.'
"${ADMIN[@]}" dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
"${ADMIN[@]}" systemctl enable --now docker
if [[ "$EUID" == 0 ]] && ! id "$TARGET_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$TARGET_USER"
fi
"${ADMIN[@]}" usermod -aG docker "$TARGET_USER"
# A new login process picks up Docker group membership immediately. Copy only
# the installer: the checkout may be under /root and may contain credentials.
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ "$TARGET_HOME" == /* && "$TARGET_HOME" != / && "$TARGET_HOME" != /root ]] || fail 'Target user needs a regular home directory.'
TARGET_GROUP="$(id -gn "$TARGET_USER")"
TARGET_DIR="$TARGET_HOME/robotshop-minikube"
[[ ! -L "$TARGET_DIR" && ! -L "$TARGET_DIR/install.sh" ]] || fail 'Installer destination must not be a symbolic link.'
"${ADMIN[@]}" install -d -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$TARGET_DIR"
"${ADMIN[@]}" install -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$SCRIPT_DIR/install.sh" "$TARGET_DIR/install.sh"
run_as_user() {
  "${ADMIN[@]}" runuser -u "$TARGET_USER" -- env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_CONFIG \
    HOME="$TARGET_HOME" USER="$TARGET_USER" LOGNAME="$TARGET_USER" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    PROFILE="${PROFILE:-mk4}" NODES="${NODES:-4}" CPUS="${CPUS:-2}" MEMORY="${MEMORY:-2048}" \
    bash -c 'cd "$HOME" && exec bash "$@"' bash "$TARGET_DIR/install.sh" "$@"
}
run_as_user install
if [[ "$START" == 1 ]]; then
  run_as_user start
fi
printf 'Ready for user %s. From root, manage the cluster with:\n' "$TARGET_USER"
printf '  runuser -l %s -c %q\n' "$TARGET_USER" "PROFILE=${PROFILE:-mk4} bash ~/robotshop-minikube/install.sh status"
printf '  runuser -l %s -c %q\n' "$TARGET_USER" "PROFILE=${PROFILE:-mk4} bash ~/robotshop-minikube/install.sh stop"
if [[ "$START" == 0 ]]; then
  echo 'To also start the cluster, rerun this setup with --start (preserving PROFILE/NODES/CPUS/MEMORY).'
fi
