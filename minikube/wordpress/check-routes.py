"""Reject an existing competing root route without deleting or changing it."""
import json
import sys


def conflicts(data):
    for ingress in data.get('items', []):
        meta = ingress.get('metadata', {})
        if (meta.get('namespace'), meta.get('name')) == ('jithendar', 'wordpress'):
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
