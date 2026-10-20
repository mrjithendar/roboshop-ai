"""Render service manifests and initialize cluster-local RobotShop credentials."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

import yaml

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ['mongodb', 'postgres', 'redis', 'rabbitmq', 'jaeger', 'otel-collector',
            'product-ingestion', 'catalogue-service', 'recommendation-service', 'shopping-agent',
            'sre-copilot', 'payment-service', 'shipping-service', 'ai-gateway',
            'frontend', 'finder', 'nginx', 'mcp-server', 'cart-service']
APPS = {name for name in SERVICES if (ROOT / 'services' / name / 'Dockerfile').is_file()}
PASSWORD_KEYS = ['MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'SHIPPING_DB_PASSWORD',
                 'SHIPPING_APP_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD',
                 'PAYMENT_SERVICE_TOKEN', 'LLM_SERVICE_TOKEN']


def render(output, prefix, tag, public_origin):
    if not re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*[a-z0-9]', prefix):
        raise ValueError('Invalid IMAGE_PREFIX.')
    if tag != 'local':
        raise ValueError('Application image tag must be local.')
    if not re.fullmatch(r'https?://[a-zA-Z0-9.-]+(?::[0-9]+)?', public_origin):
        raise ValueError('PUBLIC_ORIGIN must be an HTTP(S) origin without a path.')
    output.mkdir(parents=True, exist_ok=True)
    docs = list(yaml.safe_load_all((ROOT / 'minikube/robotshop/config.yaml').read_text()))
    docs[1]['data']['PUBLIC_ORIGIN'] = public_origin
    (output / 'config.yaml').write_text(yaml.safe_dump_all(docs, sort_keys=False))
    (output / 'ingress.yaml').write_text((ROOT / 'minikube/robotshop/ingress.yaml').read_text())
    images = []
    for name in SERVICES:
        source = ROOT / 'services' / name / (name + '-minikube.yaml')
        docs = list(yaml.safe_load_all(source.read_text()))
        for item in docs:
            if item['metadata']['namespace'] != 'robotshop-ai':
                raise ValueError('Unexpected namespace: ' + str(source))
            if item['kind'] in ('Deployment', 'StatefulSet') and name in APPS:
                suffix = 'shipping' if name == 'shipping-service' else name
                image = f'{prefix}-{suffix}:{tag}'
                item['spec']['template']['spec']['containers'][0]['image'] = image
                images.append(image)
                if name == 'finder':
                    for env in item['spec']['template']['spec']['containers'][0]['env']:
                        if env['name'] in ('ALLOWED_ORIGINS', 'UPSTREAM_ORIGIN'):
                            env['value'] = public_origin
        (output / (name + '-minikube.yaml')).write_text(yaml.safe_dump_all(docs, sort_keys=False))
    (output / 'images.txt').write_text('\n'.join(images) + '\n')


def ensure_credentials(context):
    base = ['kubectl', '--context=' + context, '--request-timeout=30s', '-n', 'robotshop-ai']
    def read(args):
        result = subprocess.run(base + args, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Kubernetes read failed; verify context and RBAC.')
        return result.stdout.strip()
    current = read(['get', 'secret', 'robotshop-secrets', '--ignore-not-found', '-o', 'json'])
    if current:
        data = json.loads(current).get('data', {})
        if any(not data.get(key) for key in PASSWORD_KEYS):
            raise RuntimeError('Existing robotshop-secrets is incomplete; restore missing credentials rather than rotating database passwords.')
        print('Reusing robotshop-secrets; no credentials changed.')
        return
    claims = read(['get', 'pvc', 'mongodb-data', 'shipping-postgres', 'rabbitmq-data', 'gateway-data',
                   '--ignore-not-found', '-o', 'name'])
    if claims:
        raise RuntimeError('Existing data PVCs found without robotshop-secrets. Restore the original Secret before deploying.')
    payload = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 'robotshop-secrets', 'namespace': 'robotshop-ai'},
               'type': 'Opaque', 'stringData': {key: secrets.token_hex(32) for key in PASSWORD_KEYS}}
    result = subprocess.run(base + ['create', '-f', '-'], input=json.dumps(payload), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Could not create robotshop-secrets. Check permissions or concurrent installation; credentials were not printed.')
    print('Created robotshop-secrets with independent random credentials (values hidden).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    render_parser = commands.add_parser('render')
    render_parser.add_argument('--output', type=Path, required=True)
    render_parser.add_argument('--prefix', default=os.getenv('IMAGE_PREFIX', 'robotshop'))
    render_parser.add_argument('--tag', default='local', choices=['local'])
    render_parser.add_argument('--public-origin', default=os.getenv('PUBLIC_ORIGIN', 'https://jithendar.com'))
    credentials = commands.add_parser('credentials')
    credentials.add_argument('--context', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'render':
            render(args.output, args.prefix, args.tag, args.public_origin)
        else:
            ensure_credentials(args.context)
    except (ValueError, RuntimeError, OSError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
