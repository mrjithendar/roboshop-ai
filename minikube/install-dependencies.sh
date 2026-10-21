#!/usr/bin/env bash
# Source from deployment scripts so the verified tools stay first in their PATH.
# Also supports standalone execution: bash minikube/install-dependencies.sh
install_deployment_dependencies() (
  set -euo pipefail
  fail() { echo "ERROR: $*" >&2; exit 1; }
  case "$(uname -s)" in
    Linux) platform=linux ;;
    Darwin) platform=darwin ;;
    *) fail 'Supported hosts: Linux and macOS.' ;;
  esac
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail 'Supported architectures: amd64 and arm64.' ;;
  esac
  elevate=()
  packages=()
  command -v curl >/dev/null || packages+=(curl)
  command -v tar >/dev/null || packages+=(tar)
  command -v gzip >/dev/null || packages+=(gzip)
  command -v openssl >/dev/null || packages+=(openssl)
  python3 -c 'import sys; assert sys.version_info >= (3, 9)' >/dev/null 2>&1 || packages+=(python3)
  if (( ${#packages[@]} )); then
    if [[ "$platform" == darwin ]]; then
      command -v brew >/dev/null || fail 'Install Homebrew first to install missing macOS dependencies.'
      brew install "${packages[@]}"
    else
      if [[ "$EUID" != 0 ]]; then
        command -v sudo >/dev/null || fail 'sudo is required to install missing OS packages.'
        sudo -v
        elevate=(sudo)
      fi
      if command -v dnf >/dev/null; then
        "${elevate[@]}" dnf install -y ca-certificates "${packages[@]}"
      elif command -v yum >/dev/null; then
        "${elevate[@]}" yum install -y ca-certificates "${packages[@]}"
      elif command -v apt-get >/dev/null; then
        "${elevate[@]}" apt-get update
        "${elevate[@]}" apt-get install -y ca-certificates "${packages[@]}"
      else
        fail 'Missing dependencies require apt, dnf or yum on Linux.'
      fi
    fi
  fi
  python3 -c 'import sys; assert sys.version_info >= (3, 9)' || fail 'Python 3.9+ is required.'
  mkdir -p "$DEPLOY_TOOL_BIN"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  fetch() { curl -fsSL --retry 3 --connect-timeout 15 --max-time 300 "$@"; }

  # Do not mistake the unrelated PyPI "helm" package for Kubernetes Helm.
  if ! helm version --short 2>/dev/null | grep -Eq '^v[34]\.'; then
    echo 'Installing Kubernetes Helm 3 (official installer with checksum verification).'
    if [[ -e "$DEPLOY_TOOL_BIN/helm" || -L "$DEPLOY_TOOL_BIN/helm" ]]; then
      backup=$(mktemp -d "$DEPLOY_TOOL_BIN/helm-backup.XXXXXX")
      mv "$DEPLOY_TOOL_BIN/helm" "$backup/helm"
      echo "Previous Helm command preserved in $backup."
    fi
    fetch https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 -o "$work/get-helm.sh"
    HELM_INSTALL_DIR="$DEPLOY_TOOL_BIN" USE_SUDO=false VERIFY_CHECKSUM=true bash "$work/get-helm.sh"
  else
    echo 'Reusing installed Kubernetes Helm.'
  fi

  if ! kubectl version --client -o json >/dev/null 2>&1; then
    # Match this repository's Minikube Kubernetes version; override for another cluster.
    version="${KUBECTL_VERSION:-v1.37.0}"
    [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid KUBECTL_VERSION.'
    fetch "https://dl.k8s.io/release/$version/bin/$platform/$arch/kubectl" -o "$work/kubectl"
    fetch "https://dl.k8s.io/release/$version/bin/$platform/$arch/kubectl.sha256" -o "$work/kubectl.sha256"
    python3 - "$work" <<'PY'
import hashlib, pathlib, sys
directory = pathlib.Path(sys.argv[1])
actual = hashlib.sha256((directory / 'kubectl').read_bytes()).hexdigest()
expected = (directory / 'kubectl.sha256').read_text().strip()
if actual != expected:
    raise SystemExit('kubectl checksum verification failed')
PY
    if [[ -e "$DEPLOY_TOOL_BIN/kubectl" || -L "$DEPLOY_TOOL_BIN/kubectl" ]]; then
      backup=$(mktemp -d "$DEPLOY_TOOL_BIN/kubectl-backup.XXXXXX")
      mv "$DEPLOY_TOOL_BIN/kubectl" "$backup/kubectl"
    fi
    install -m 0755 "$work/kubectl" "$DEPLOY_TOOL_BIN/kubectl"
  else
    echo 'Reusing installed kubectl.'
  fi
  helm version --short
  kubectl version --client
)
# Root repairs /usr/local/bin/helm, including the broken pip launcher.
# Regular users get private binaries without needing sudo for Helm/kubectl.
if [[ "$EUID" == 0 ]]; then
  DEPLOY_TOOL_BIN=/usr/local/bin
else
  DEPLOY_TOOL_BIN="$HOME/.local/bin"
fi
export PATH="$DEPLOY_TOOL_BIN:$PATH"
install_deployment_dependencies
hash -r
