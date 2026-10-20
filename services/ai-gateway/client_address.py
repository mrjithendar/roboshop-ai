import os
import ipaddress


def client_address(req):
    peer = req.environ.get("REMOTE_ADDR", "")
    try:
        address = ipaddress.ip_address(peer)
        trusted = [
            ipaddress.ip_network(c.strip())
            for c in os.getenv("TRUSTED_PROXY_CIDRS", "").split(",")
            if c.strip()
        ]
        if os.getenv("TRUST_PROXY") == "true" and any(
            address in net for net in trusted
        ):
            return str(ipaddress.ip_address(req.headers.get("x-real-ip", "")))
        return str(address)
    except ValueError:
        return peer

