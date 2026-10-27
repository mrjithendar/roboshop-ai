"""Reject an existing competing root route without deleting or changing it."""

# Portable operator command; imports remain usable by isolated tests.
if __name__ == '__main__':
    import sys as _host_sys
    if not any(arg in ('--help', '-h') for arg in _host_sys.argv[1:]):
        import subprocess as _host_subprocess
        from pathlib import Path as _HostPath
        _host_gate = _HostPath(__file__).resolve().parent / '../..' / 'scripts/lib/require-centos.sh'
        if _host_subprocess.call(['bash', str(_host_gate)]):
            raise SystemExit(1)

import json
import sys


def conflicts(data):
    for ingress in data.get('items', []):
        meta = ingress.get('metadata', {})
        # The WordPress chart owns the root route and its HTTP/alias redirects.
        if meta.get('namespace') == 'jithendar' and meta.get('name') in ('wordpress', 'wordpress-http', 'wordpress-alias'):
            continue
        for rule in ingress.get('spec', {}).get('rules', []):
            if rule.get('host') not in ('jithendar.com', '*.com', None, ''):
                continue
            for path in rule.get('http', {}).get('paths', []):
                if path.get('path', '/') == '/':
                    yield f"{meta.get('namespace')}/{meta.get('name')}"


if __name__ == '__main__':
    found = sorted(set(conflicts(json.load(sys.stdin))))
    if found:
        sys.exit('Existing root Ingress route(s): ' + ', '.join(found) +
                 '. Move these to another hostname/path before deploying WordPress; no routes were removed.')
