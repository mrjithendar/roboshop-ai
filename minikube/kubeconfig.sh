#!/bin/sh
# Run locally. Works with both `sh` and `bash`; never starts an SSH tunnel.
set -eu
VULTR_HOST="${VULTR_HOST:-root@jithendar.com}"
API_HOST="${API_HOST:-jithendar.com}"
BASE_PROFILE="${PROFILE:-mk4}"
CONFIG="${CONFIG:-$HOME/.kube/vultr-minikube.json}"
fail() { echo "ERROR: $*" >&2; exit 1; }
case "$BASE_PROFILE" in ''|*[!a-zA-Z0-9_.-]*) fail 'Invalid PROFILE.' ;; esac
case "$VULTR_HOST" in -*|'') fail 'Invalid VULTR_HOST.' ;; esac
for tool in ssh kubectl python3; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required locally."; done
umask 077
mkdir -p "$(dirname "$CONFIG")"
TEMP_CONFIG_DIR="$(mktemp -d "$(dirname "$CONFIG")/.vultr-config.XXXXXX")"
trap 'rm -rf "$TEMP_CONFIG_DIR"' EXIT HUP INT TERM
# A single SSH connection discovers the selected profile and exports current
# embedded certificates. No dependency on an old *-direct.json export.
if ! ssh "$VULTR_HOST" bash -s -- "$BASE_PROFILE" > "$TEMP_CONFIG_DIR/source.json" <<'REMOTE'
set -euo pipefail
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"
profile="$1"
state="${MINIKUBE_HOME:-$HOME/.minikube}/robotshop-installer/$profile.profile"
if [[ -f "$state" ]]; then profile="$(cat "$state")"; fi
[[ "$profile" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid saved Minikube profile.' >&2; exit 1; }
[[ -f "${MINIKUBE_HOME:-$HOME/.minikube}/profiles/$profile/config.json" ]] || {
  echo "Minikube profile $profile does not exist for $(id -un). Check minikube profile list on Vultr." >&2; exit 1;
}
bindings="$(docker port "$profile" 8443/tcp)"
port="$(printf '%s\n' "$bindings" | awk -F: '/^0[.]0[.]0[.]0:/ {print $NF; exit}')"
[[ "$port" =~ ^[0-9]+$ ]] || {
  echo "Selected profile: $profile; actual API bindings: ${bindings:-none}" >&2
  echo "Profile $profile has no API port published on 0.0.0.0. Enable direct access with PUBLIC_HOST=jithendar.com using minikube/install.sh on Vultr." >&2
  echo 'Changing access settings may create a replacement cluster; existing workloads are not migrated.' >&2
  exit 1
}
kubectl --context="$profile" config view --minify --raw --flatten -o json | jq --arg port "$port" '{port: $port, config: .}'
REMOTE
then
  fail 'Remote export failed. Your existing local kubeconfig was not changed.'
fi
python3 - "$TEMP_CONFIG_DIR/source.json" "$TEMP_CONFIG_DIR/config.json" "$API_HOST" <<'PY'
import json, re, sys
from urllib.parse import urlsplit
source, destination, host = sys.argv[1:]
if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', host):
    raise SystemExit('API_HOST must be a hostname or IPv4 address, without scheme, port or path.')
with open(source) as f:
    export = json.load(f)
port = int(export['port'])
if not 1 <= port <= 65535:
    raise SystemExit('Invalid remote API port.')
config = export['config']
if len(config.get('clusters', [])) != 1 or not config.get('current-context'):
    raise SystemExit('Remote export does not contain one selected cluster.')
cluster = config['clusters'][0]['cluster']
original_host = urlsplit(cluster['server']).hostname
if not original_host or not cluster.get('certificate-authority-data'):
    raise SystemExit('Remote export is missing the API hostname or embedded CA certificate.')
# Authenticate against the original API identity (also valid for IP-based SANs).
# Never disable TLS validation when replacing the transport endpoint.
cluster.setdefault('tls-server-name', original_host)
cluster['server'] = f'https://{host}:{port}'
cluster['insecure-skip-tls-verify'] = False
cluster.pop('proxy-url', None)
with open(destination, 'w') as f:
    json.dump(config, f, indent=2)
print(f"Checking direct API: {cluster['server']}")
PY
chmod 600 "$TEMP_CONFIG_DIR/config.json"
# Validate before replacing a working config. No fallback to an old tunnel file.
if ! kubectl --kubeconfig="$TEMP_CONFIG_DIR/config.json" --request-timeout=15s get nodes; then
  fail 'Direct API check failed. Check DNS and allow its published TCP port from your local public IP in Vultr Firewall. Existing local config was preserved.'
fi
mv "$TEMP_CONFIG_DIR/config.json" "$CONFIG"
printf 'Saved direct kubeconfig: %s\n' "$CONFIG"
printf 'For this terminal, run: export KUBECONFIG="%s"\n' "$CONFIG"
echo 'Then run: kubectl get pods -A'
