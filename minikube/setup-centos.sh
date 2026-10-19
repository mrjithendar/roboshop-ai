#!/usr/bin/env bash
# Optional host prerequisites; run as the user who will run Minikube.
set -euo pipefail
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: bash minikube/setup-centos.sh'
  echo 'Installs Docker prerequisites using sudo, enables Docker, and adds your user to the docker group.'
  exit 0
fi
[[ $# == 0 ]] || fail 'No arguments expected.'
[[ "$(uname -s)" == Linux && -r /etc/os-release ]] || fail 'This setup requires CentOS Stream 9 or 10.'
. /etc/os-release
[[ "${ID:-}" == centos && "${NAME:-}" == *Stream* ]] || fail 'This setup requires CentOS Stream 9 or 10.'
case "${VERSION_ID:-}" in 9|10) ;; *) fail 'Use CentOS Stream 9 or 10; older CentOS releases are unsupported.' ;; esac
case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) fail 'Supported architectures: amd64 and arm64.' ;; esac
[[ "$EUID" -ne 0 ]] || fail 'Run as your normal login user, without sudo; individual host commands use sudo.'
command -v sudo >/dev/null || fail 'Ask your administrator to configure sudo for your user.'
# Do not silently erase an existing container runtime or conflicting packages.
for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman-docker; do
  if rpm -q "$package" >/dev/null 2>&1; then
    fail "Conflicting package $package is installed. Review https://docs.docker.com/engine/install/centos/ before replacing it."
  fi
done
echo 'Installing Docker Engine and enabling it at boot. Docker group membership grants root-level host access.'
sudo dnf install -y ca-certificates coreutils dnf-plugins-core
# curl-minimal, supplied by some cloud images, is sufficient.
command -v curl >/dev/null 2>&1 || sudo dnf install -y curl
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
echo 'Verify the Docker signing key against https://docs.docker.com/engine/install/centos/ if prompted.'
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$(id -un)"
echo 'Log out and log back in to activate group membership. Then run:'
echo '  docker info'
echo '  bash minikube/install.sh start'
