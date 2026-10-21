#!/usr/bin/env bash
# Run on your Mac/Linux workstation. Keep the current kubeconfig untouched.
set -euo pipefail
umask 077
if [[ $# != 2 ]]; then
  echo 'Usage: bash k3s/kubeconfig.sh SSH_TARGET API_HOST' >&2
  echo 'Example: bash k3s/kubeconfig.sh root@SERVER_PUBLIC_IP k3s.jithendar.com' >&2
  exit 1
fi
[[ $1 != -* && $2 =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid SSH target/API host' >&2; exit 1; }
command -v kubectl >/dev/null
mkdir -p "$HOME/.kube"
target="$HOME/.kube/vultr-k3s.yaml"
[[ ! -e $target ]] || { echo "$target already exists; move it to a backup before exporting again." >&2; exit 1; }
tmp=$(mktemp "$HOME/.kube/.k3s-export.XXXXXX")
trap 'rm -f "$tmp"' EXIT
# Non-root remote users need passwordless sudo for this one command.
ssh "$1" 'if [ "$(id -u)" = 0 ]; then cat /etc/rancher/k3s/k3s.yaml; else sudo -n cat /etc/rancher/k3s/k3s.yaml; fi' > "$tmp"
[[ -s $tmp ]]
kubectl --kubeconfig="$tmp" config set-cluster default --server="https://$2:6443" >/dev/null
kubectl --kubeconfig="$tmp" config rename-context default vultr-k3s >/dev/null
# Verify certificate, credentials and connectivity before writing the final file.
kubectl --kubeconfig="$tmp" --request-timeout=15s get nodes
mv "$tmp" "$target"
printf 'Saved %s\nUse: kubectl --kubeconfig="%s" get nodes\n' "$target" "$target"
