#!/usr/bin/env bash
# Run on each Vultr Linux instance. No Docker or Minikube is required.
set -euo pipefail
umask 077
fail() { echo "ERROR: $*" >&2; exit 1; }
if [[ ${1:-} == --help || $# == 0 ]]; then
  cat <<'HELP'
Usage: sudo bash k3s/install.sh server|agent PRIVATE_IP VPC_INTERFACE NODE_NAME [SERVER_PRIVATE_IP]
Server: optional API_HOST adds a public domain/IP to the API certificate.
Agent: K3S_VERSION must match the server; JOIN_TOKEN_FILE supplies its join token.
       Without JOIN_TOKEN_FILE, the token is requested without echoing it.
Set K3S_VERSION on the server to pin a release; otherwise initial install uses stable.
Existing configurations are not overwritten and existing nodes are not upgraded.
HELP
  exit 0
fi
[[ $(uname -s) == Linux ]] || fail 'Run this installer on the Vultr Linux host.'
[[ $EUID == 0 ]] || fail 'Run with sudo or as root (see README for sudo environment flags).'
command -v systemctl >/dev/null || fail 'A systemd Linux host is required.'
role=$1
[[ $role == server || $role == agent ]] || fail 'Role must be server or agent.'
[[ $# == 4 || ( $role == agent && $# == 5 ) ]] || fail 'Incorrect arguments; use --help.'
node_ip=$2; iface=$3; node_name=$4; server_ip=${5:-}
valid_ip() {
  local octets part
  [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a octets <<< "$1"
  for part in "${octets[@]}"; do [[ ${#part} -le 3 ]] && ((10#$part <= 255)) || return 1; done
}
valid_ip "$node_ip" || fail 'Use an IPv4 VPC address.'
[[ $node_name =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ && ${#node_name} -le 63 ]] || fail 'Invalid node name.'
[[ $iface =~ ^[a-zA-Z0-9_.:-]+$ ]] || fail 'Invalid VPC interface.'
command -v ip >/dev/null || fail 'Install iproute2 (Debian/Ubuntu) or iproute (CentOS/Rocky).'
ip -4 -o addr show dev "$iface" | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$node_ip" || fail 'The VPC address is not assigned to that interface.'
api_host=${API_HOST:-}
[[ -z $api_host || $api_host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail 'API_HOST must be a hostname or IPv4 address, without scheme/port.'
version=${K3S_VERSION:-}
[[ -z $version || $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+\+k3s[0-9]+$ ]] || fail 'Invalid K3S_VERSION.'
if [[ $role == agent ]]; then
  valid_ip "$server_ip" || fail 'An agent requires the server VPC IPv4 address.'
  [[ -n $version ]] || fail 'Set K3S_VERSION to the server version shown after installation.'
fi
# Refuse takeover: reruns must not reset credentials, change node identity, or upgrade.
[[ ! -e /etc/rancher/k3s/config.yaml && ! -d /etc/rancher/k3s/config.yaml.d && ! -d /var/lib/rancher/k3s && ! -e /etc/systemd/system/k3s.service && ! -e /etc/systemd/system/k3s-agent.service ]] || fail 'Existing K3s configuration/data found. Inspect it first; this installer does not overwrite or upgrade nodes.'
if ! command -v curl >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get update; apt-get install -y curl ca-certificates
  elif command -v dnf >/dev/null; then dnf install -y curl ca-certificates
  else fail 'Install curl and CA certificates first.'; fi
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Download first, then execute; errors cannot leave a truncated script executing.
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 120 https://get.k3s.io -o "$work/install.sh"
if [[ $role == agent ]]; then
  if [[ -n ${JOIN_TOKEN_FILE:-} ]]; then
    [[ -r $JOIN_TOKEN_FILE ]] || fail 'JOIN_TOKEN_FILE is not readable.'
    token=$(cat "$JOIN_TOKEN_FILE")
  else
    read -r -s -p 'Paste the server node-token: ' token </dev/tty
    echo >&2
  fi
  [[ -n $token && $token != *$'\n'* && $token != *$'\r'* ]] || fail 'Invalid join token.'
fi
install -d -m 700 /etc/rancher/k3s
{
  printf 'node-name: "%s"\nnode-ip: "%s"\nflannel-iface: "%s"\n' "$node_name" "$node_ip" "$iface"
  if [[ $role == server ]]; then
    printf 'write-kubeconfig-mode: "0600"\ntls-san:\n  - "%s"\n' "$node_ip"
    [[ -z $api_host ]] || printf '  - "%s"\n' "$api_host"
  else
    printf 'server: "https://%s:6443"\ntoken-file: /etc/rancher/k3s/join-token\n' "$server_ip"
  fi
} > /etc/rancher/k3s/config.yaml
if [[ $role == agent ]]; then
  printf '%s\n' "$token" > /etc/rancher/k3s/join-token
  unset token
fi
# Config-file settings persist across service restarts; never put tokens in arguments.
# Explicit exec prevents inherited K3S_URL from accidentally selecting agent mode.
env -u K3S_URL -u K3S_TOKEN -u K3S_TOKEN_FILE INSTALL_K3S_EXEC="$role" \
  INSTALL_K3S_CHANNEL=stable INSTALL_K3S_VERSION="$version" sh "$work/install.sh"
service=k3s
[[ $role == server ]] || service=k3s-agent
systemctl is-active --quiet "$service" || fail "Inspect journalctl -u $service for installation errors."
k3s --version
if [[ $role == server ]]; then
  echo 'Server installed. Join three agents using this exact K3s version.'
  echo 'Join token: /var/lib/rancher/k3s/server/node-token (keep private).'
  echo 'Inspect nodes: sudo k3s kubectl get nodes -o wide'
else
  echo 'Agent installed. Check its Ready status from the server.'
fi
