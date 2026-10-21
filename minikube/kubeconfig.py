#!/usr/bin/env python3
"""Convert a remote Minikube export into a direct-access kubeconfig.

kubeconfig.sh handles SSH, private temporary files, connection checks and the
final file replacement. This helper only validates and transforms JSON.
"""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


def prepare_config(export: dict, host: str) -> dict:
    """Update the connection address while retaining the trusted API identity."""
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host):
        raise ValueError(
            "API_HOST must be a hostname or IPv4 address, without scheme, port or path."
        )

    port = int(export["port"])
    if not 1 <= port <= 65535:
        raise ValueError("Invalid remote API port.")

    config = export["config"]
    if len(config.get("clusters", [])) != 1 or not config.get("current-context"):
        raise ValueError("Remote export does not contain one selected cluster.")

    cluster = config["clusters"][0]["cluster"]
    original_host = urlsplit(cluster["server"]).hostname
    if not original_host or not cluster.get("certificate-authority-data"):
        raise ValueError(
            "Remote export is missing the API hostname or embedded CA certificate."
        )

    # The transport uses the public domain; certificate validation still uses
    # the original API identity, including IP-based certificate SANs.
    cluster.setdefault("tls-server-name", original_host)
    cluster["server"] = f"https://{host}:{port}"
    cluster["insecure-skip-tls-verify"] = False
    cluster.pop("proxy-url", None)
    return config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Remote JSON containing port and config")
    parser.add_argument("destination", type=Path, help="Temporary kubeconfig output path")
    parser.add_argument("host", help="Public hostname or IPv4 address")
    args = parser.parse_args()

    try:
        with args.source.open() as source:
            config = prepare_config(json.load(source), args.host)
        # This file contains client credentials, so keep it private even when
        # the helper is invoked independently of the shell script.
        with args.destination.open("w") as destination:
            args.destination.chmod(0o600)
            json.dump(config, destination, indent=2)
            destination.write("\n")
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        parser.exit(1, f"ERROR: Could not prepare kubeconfig: {error}\n")

    print(f"Checking direct API: {config['clusters'][0]['cluster']['server']}")


if __name__ == "__main__":
    main()
