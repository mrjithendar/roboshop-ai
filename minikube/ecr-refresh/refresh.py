"""Patch pre-created pull secrets; never log credentials or API response bodies."""
import base64
import datetime
import json
import os
from pathlib import Path
import ssl
import urllib.request


def refresh(registry, namespaces, request, authorization):
    decoded = base64.b64decode(authorization, validate=True).decode()
    if not decoded.startswith('AWS:') or len(decoded) <= 4:
        raise ValueError('Invalid ECR authorization token')
    failures = []
    for namespace in namespaces:
        path = f'/api/v1/namespaces/{namespace}/secrets/ecr-pull'
        try:
            existing = request('GET', path)
            if existing['type'] != 'kubernetes.io/dockerconfigjson':
                raise ValueError('Unexpected secret type')
            config = json.loads(base64.b64decode(existing['data']['.dockerconfigjson']))
            config.setdefault('auths', {})[registry] = {'auth': authorization}
            request('PATCH', path, {
                'metadata': {'resourceVersion': existing['metadata']['resourceVersion'],
                             'annotations': {'roboshop.ai/ecr-refreshed-at': datetime.datetime.now(datetime.timezone.utc).isoformat()}},
                'data': {'.dockerconfigjson': base64.b64encode(json.dumps(config).encode()).decode()}})
            print(f'{namespace}: ecr-pull refreshed', flush=True)
        except Exception as error:
            # Exception text may include response data. Log only its class.
            print(f'{namespace}: refresh failed ({type(error).__name__})', flush=True)
            failures.append(namespace)
    if failures:
        raise RuntimeError('Some namespaces failed; existing credentials were not deleted')


def main():
    token = Path('/var/run/api/token').read_text().strip()
    context = ssl.create_default_context(cafile='/var/run/api/ca.crt')
    def request(method, path, body=None):
        req = urllib.request.Request('https://kubernetes.default.svc' + path,
            data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/merge-patch+json'})
        with urllib.request.urlopen(req, context=context, timeout=20) as response:
            return json.loads(response.read(2 * 1024 * 1024))
    refresh(os.environ['ECR_REGISTRY'], os.environ['TARGET_NAMESPACES'].split(','),
            request, Path('/work/token').read_text().strip())


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ECR refresh failed ({type(error).__name__}); inspect job status and AWS/Kubernetes permissions.', flush=True)
        raise SystemExit(1)
