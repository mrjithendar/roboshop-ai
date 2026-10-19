#!/usr/bin/env bash
# Install prerequisites and run Minikube as the current effective user.
set -euo pipefail
fail() { echo "ERROR: $*" >&2; exit 1; }
START=1
case "${1:-}" in
  --help|-h) echo 'Usage: bash minikube/setup-centos.sh [--start|--install-only]'; echo 'Defaults to installing and starting as the current user (including root).'; exit 0 ;;
  ''|--start) ;;
  --install-only) START=0 ;;
  *) fail 'Expected --start or --install-only.' ;;
esac
[[ $# -le 1 ]] || fail 'Expected at most one option.'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/install.sh" ]] || fail 'Keep install.sh beside setup-centos.sh.'
[[ "$(uname -s)" == Linux && -r /etc/os-release ]] || fail 'This setup requires CentOS Stream 9 or 10.'
. /etc/os-release
[[ "${ID:-}" == centos && "${NAME:-}" == *Stream* ]] || fail 'This setup requires CentOS Stream 9 or 10.'
case "${VERSION_ID:-}" in 9|10) ;; *) fail 'Use CentOS Stream 9 or 10.' ;; esac
case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) fail 'Supported architectures: amd64 and arm64.' ;; esac
CURRENT_USER="$(id -un)"
ADMIN=()
if [[ "$EUID" != 0 ]]; then
  command -v sudo >/dev/null || fail 'sudo is required to install host dependencies.'
  ADMIN=(sudo)
fi
for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman-docker; do
  if rpm -q "$package" >/dev/null 2>&1; then
    fail "Conflicting package $package is installed. Review https://docs.docker.com/engine/install/centos/ before replacing it."
  fi
done
echo "Preparing Docker and Minikube for current user: $CURRENT_USER"
"${ADMIN[@]}" dnf install -y ca-certificates coreutils dnf-plugins-core shadow-utils util-linux
command -v curl >/dev/null 2>&1 || "${ADMIN[@]}" dnf install -y curl
"${ADMIN[@]}" dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
"${ADMIN[@]}" dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
"${ADMIN[@]}" systemctl enable --now docker
if [[ "$EUID" != 0 ]]; then
  echo 'Adding the current user to the Docker group (root-level host access).'
  sudo usermod -aG docker "$CURRENT_USER"
fi
# Download as the current user into temporary storage, then publish real binaries
# on the standard system PATH. No user forwarding wrappers or shell edits.
TOOLS_DIR="$(mktemp -d)"
trap 'rm -rf "$TOOLS_DIR"' EXIT
INSTALL_DIR="$TOOLS_DIR" bash "$SCRIPT_DIR/install.sh" install
"${ADMIN[@]}" install -d -m 0755 /usr/local/bin
for tool in minikube kubectl; do
  source_binary="$TOOLS_DIR/$tool"
  if [[ ! -f "$source_binary" ]]; then source_binary="$(command -v "$tool")"; fi
  destination="/usr/local/bin/$tool"
  if [[ "$source_binary" != "$destination" ]]; then
    [[ ! -L "$destination" ]] || fail "Refusing to overwrite symlink $destination."
    if [[ ! -e "$destination" ]] || grep -aq '^# RobotShop managed CLI wrapper$' "$destination"; then
      "${ADMIN[@]}" install -o root -g root -m 0755 "$source_binary" "$destination"
    fi
  fi
done
export PATH="/usr/local/bin:$PATH"
if [[ "$START" == 1 ]]; then
  if [[ "$EUID" == 0 ]]; then
    bash "$SCRIPT_DIR/install.sh" start
  else
    # Refresh supplementary groups for the same user without a logout.
    sudo runuser -u "$CURRENT_USER" -- env HOME="$HOME" PATH="$PATH" \
      PROFILE="${PROFILE:-mk4}" NODES="${NODES:-4}" CPUS="${CPUS:-2}" MEMORY="${MEMORY:-2048}" \
      bash "$SCRIPT_DIR/install.sh" start
  fi
fi
printf 'Ready for %s. Commands: minikube version; minikube -p %s status; kubectl --context=%s get nodes\n' "$CURRENT_USER" "${PROFILE:-mk4}" "${PROFILE:-mk4}"
