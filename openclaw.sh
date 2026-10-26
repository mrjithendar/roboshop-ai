export OPENCLAW_CONTEXT=mk4

# Use a Python environment with the documented dependencies installed.
./scripts/openclaw.sh validate
./scripts/openclaw.sh test

python3 scripts/openclaw/network_smoke.py \
  --output /secure/path/openclaw-network.json

export OPENCLAW_NETWORK_EVIDENCE=/secure/path/openclaw-network.json

python3 scripts/openclaw/refresh_registry.py

./scripts/openclaw.sh bootstrap
./scripts/openclaw.sh status


kubectl --context "$OPENCLAW_CONTEXT" apply -f minikube/openclaw/base/namespace.yaml

python3 scripts/openclaw/refresh_registry.py

unset OPENCLAW_NETWORK_EVIDENCE

install -d -m 700 "$HOME/.local/state/openclaw"

python3 scripts/openclaw/network_smoke.py --output "$HOME/.local/state/openclaw/network-evidence.json"

export OPENCLAW_NETWORK_EVIDENCE="$HOME/.local/state/openclaw/network-evidence.json"
./scripts/openclaw.sh bootstrap
./scripts/openclaw.sh status

python3 scripts/openclaw/prepare_secrets.py \
  --output "$HOME/.local/state/openclaw/initial-secrets.json"

kubectl --context "$OPENCLAW_CONTEXT" create -f "$HOME/.local/state/openclaw/initial-secrets.json" &&
./scripts/openclaw.sh bootstrap && ./scripts/openclaw.sh status