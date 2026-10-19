#!/usr/bin/env bash
# Docker-backed Minikube on Linux and macOS (amd64/arm64).
set -euo pipefail
PROFILE="${PROFILE:-mk4}"
CPUS="${CPUS:-2}"
MEMORY="${MEMORY:-2048}" # MiB per node.
NODES="${NODES:-4}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
ACTION="${1:-start}"
fail() { echo "ERROR: $*" >&2; exit 1; }
usage() {
  echo 'Usage: bash minikube/install.sh [install|start|status|stop]'
  echo 'Overrides: PROFILE, NODES, CPUS, MEMORY (MiB/node), INSTALL_DIR'
  echo 'Linux root sessions delegate to MINIKUBE_USER (default robotshop).'
  echo 'Optional download pins: MINIKUBE_VERSION=vX.Y.Z, KUBECTL_VERSION=vX.Y.Z'
}
case "$ACTION" in -h|--help|help) usage; exit 0 ;; install|start|status|stop) ;; *) usage >&2; exit 1 ;; esac
[[ $# -le 1 ]] || fail 'Expected at most one action.'
case "$(uname -s)" in Linux) OS=linux ;; Darwin) OS=darwin ;; *) fail 'Supported systems: Linux and macOS.' ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=amd64 ;; arm64|aarch64) ARCH=arm64 ;; *) fail 'Supported architectures: amd64 and arm64.' ;; esac
if [[ "$EUID" == 0 ]]; then
  [[ "$OS" == linux ]] || fail 'On macOS, run as your normal user.'
  TARGET_USER="${MINIKUBE_USER:-${SUDO_USER:-robotshop}}"
  [[ "$TARGET_USER" == root ]] && TARGET_USER=robotshop
  [[ "$TARGET_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid MINIKUBE_USER.'
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  if ! id "$TARGET_USER" >/dev/null 2>&1; then
    if [[ "$ACTION" == install || "$ACTION" == start ]]; then
      [[ -f "$SCRIPT_DIR/setup-centos.sh" ]] || fail 'Run minikube/setup-centos.sh first to create the runtime user.'
      export MINIKUBE_USER="$TARGET_USER" PROFILE NODES CPUS MEMORY
      if [[ "$ACTION" == start ]]; then
        exec bash "$SCRIPT_DIR/setup-centos.sh" --start
      fi
      exec bash "$SCRIPT_DIR/setup-centos.sh"
    fi
    fail "User $TARGET_USER does not exist. Run setup-centos.sh first."
  fi
  [[ "$(id -u "$TARGET_USER")" -ge 1000 ]] || fail 'MINIKUBE_USER must have a regular UID >= 1000.'
  TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  [[ "$TARGET_HOME" == /* && "$TARGET_HOME" != / && "$TARGET_HOME" != /root && -d "$TARGET_HOME" ]] || fail 'Runtime user needs a regular home directory.'
  command -v runuser >/dev/null 2>&1 || fail 'Install util-linux to provide runuser.'
  echo "Running $ACTION as $TARGET_USER; your shell remains root."
  # Stream this script through stdin so /root checkouts need no permission changes.
  # Clear root's Docker, Kubernetes and home configuration before delegation.
  exec runuser -u "$TARGET_USER" -- env -i \
    HOME="$TARGET_HOME" USER="$TARGET_USER" LOGNAME="$TARGET_USER" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    PROFILE="$PROFILE" NODES="$NODES" CPUS="$CPUS" MEMORY="$MEMORY" \
    MINIKUBE_VERSION="${MINIKUBE_VERSION:-}" KUBECTL_VERSION="${KUBECTL_VERSION:-}" \
    bash -c 'cd "$HOME" && exec bash -s -- "$@"' bash "$ACTION" < "${BASH_SOURCE[0]}"
fi
[[ "$INSTALL_DIR" == /* ]] || fail 'INSTALL_DIR must be an absolute path.'
export PATH="$INSTALL_DIR:$PATH"
TEMP_DIR=''
trap '[[ -z "$TEMP_DIR" ]] || rm -rf "$TEMP_DIR"' EXIT
trap 'echo "Failed at line $LINENO. For cluster diagnostics: minikube logs -p $PROFILE" >&2' ERR
fetch() { curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 300 "$@"; }
install_binary() {
  local name="$1" url="$2" expected actual
  command -v curl >/dev/null 2>&1 || fail 'Install curl using your OS package manager.'
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    fail 'Install sha256sum or shasum to verify downloads.'
  fi
  [[ -n "$TEMP_DIR" ]] || TEMP_DIR="$(mktemp -d)"
  echo "Downloading $name for $OS/$ARCH..."
  fetch "$url" -o "$TEMP_DIR/$name"
  expected="$(fetch "$url.sha256" | awk '{print $1}')"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail "Invalid checksum for $name."
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$TEMP_DIR/$name" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$TEMP_DIR/$name" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || fail "Checksum mismatch for $name; nothing installed."
  mkdir -p "$INSTALL_DIR"
  install -m 0755 "$TEMP_DIR/$name" "$INSTALL_DIR/$name"
}
if [[ "$ACTION" == install || "$ACTION" == start ]]; then
  # Existing tools are preserved; version pins apply only when downloading missing tools.
  if ! command -v minikube >/dev/null 2>&1; then
    version="${MINIKUBE_VERSION:-latest}"
    [[ "$version" == latest || "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid MINIKUBE_VERSION.'
    install_binary minikube "https://storage.googleapis.com/minikube/releases/$version/minikube-$OS-$ARCH"
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || fail 'Install curl using your OS package manager.'
    version="${KUBECTL_VERSION:-$(fetch https://dl.k8s.io/release/stable.txt)}"
    [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid KUBECTL_VERSION.'
    install_binary kubectl "https://dl.k8s.io/release/$version/bin/$OS/$ARCH/kubectl"
  fi
  printf 'Tools available. For future shells, add this directory to PATH: %s\n' "$INSTALL_DIR"
fi
[[ "$ACTION" != install ]] || exit 0
command -v minikube >/dev/null 2>&1 || fail 'Run this script with install first.'
if [[ "$ACTION" != start ]]; then
  minikube --profile="$PROFILE" "$ACTION"
  exit 0
fi
for value in "$NODES" "$CPUS" "$MEMORY"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail 'NODES, CPUS and MEMORY must be positive integers.'
done
DOCKER_APP=''
if [[ "$OS" == darwin ]]; then
  for candidate in /Applications/Docker.app "$HOME/Applications/Docker.app"; do
    if [[ -d "$candidate" ]]; then DOCKER_APP="$candidate"; break; fi
  done
  if [[ -n "$DOCKER_APP" ]]; then
    export PATH="$PATH:$DOCKER_APP/Contents/Resources/bin"
  fi
fi
if [[ "$OS" == linux && -r /etc/os-release ]]; then
  distro_id="$(. /etc/os-release; printf '%s' "${ID:-}")"
  if [[ "$distro_id" == centos ]]; then
    echo 'CentOS: for Docker prerequisites, run bash minikube/setup-centos.sh (Stream 9/10).'
  fi
fi
command -v docker >/dev/null 2>&1 || fail 'Install Docker Engine on Linux or Docker Desktop on macOS, then rerun. See minikube/README.md.'
if ! docker info >/dev/null 2>&1; then
  if [[ "$OS" == darwin && -n "$DOCKER_APP" ]]; then
    open -a "$DOCKER_APP" || fail 'Could not open Docker Desktop.'
    echo 'Waiting up to 180 seconds for Docker Desktop; complete any first-run prompts.'
    ready=0
    for ((i=0; i<90; i++)); do
      if docker info >/dev/null 2>&1; then ready=1; break; fi
      sleep 2
    done
    [[ "$ready" == 1 ]] || fail 'Docker is unavailable. Check Docker Desktop and your Docker context.'
  elif [[ "$OS" == darwin ]]; then
    echo "Docker context: $(docker context show 2>/dev/null || echo unknown)" >&2
    fail 'Docker CLI is installed, but its engine is unreachable and Docker Desktop was not found in /Applications or ~/Applications. Install/open Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/), or start your alternative Docker runtime and select its context. Confirm docker info succeeds, then rerun.'
  else
    fail 'Docker is unavailable to your user. On systemd hosts run sudo systemctl start docker; after Docker group changes log out and back in. Check docker info and docker context ls. Do not run this script with sudo.'
  fi
fi
[[ "$(docker info --format '{{.OSType}}')" == linux ]] || fail 'Docker must run Linux containers.'
echo "Starting $PROFILE: $NODES nodes, each with $CPUS CPUs and $MEMORY MiB RAM."
echo 'Ensure the host (or Docker Desktop VM) has capacity for every node plus your workloads.'
minikube start --profile="$PROFILE" --driver=docker --nodes="$NODES" \
  --cpus="$CPUS" --memory="$MEMORY" --container-runtime=containerd --wait=all --wait-timeout=10m
kubectl --context="$PROFILE" wait --for=condition=Ready nodes --all --timeout=300s
count="$(kubectl --context="$PROFILE" get nodes -o name | wc -l | tr -d '[:space:]')"
[[ "$count" == "$NODES" ]] || fail "Expected $NODES nodes, found $count. Use a fresh PROFILE when changing topology."
kubectl --context="$PROFILE" get nodes -o wide
echo "Ready. Use: kubectl --context=$PROFILE get pods -A"
