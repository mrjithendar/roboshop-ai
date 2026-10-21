VULTR_HOST=root@jithendar.com

API_TARGET=$(python3 - "$CONFIG" <<'PY'
import json, sys
from urllib.parse import urlsplit

path = sys.argv[1]
with open(path) as f:
    config = json.load(f)

cluster = config["clusters"][0]["cluster"]
url = urlsplit(cluster["server"])
host = url.hostname
port = url.port or 443

cluster.setdefault("tls-server-name", host)
cluster["server"] = "https://127.0.0.1:16443"

with open(path, "w") as f:
    json.dump(config, f, indent=2)

print(f"[{host}]:{port}" if ":" in host else f"{host}:{port}")
PY
)

ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -L "127.0.0.1:16443:$API_TARGET" \
  "$VULTR_HOST"