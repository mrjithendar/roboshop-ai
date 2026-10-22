"""Render service manifests and initialize cluster-local RoboShop credentials."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
SERVICES = ['mongodb', 'postgres', 'redis', 'rabbitmq', 'jaeger', 'otel-collector',
            'product-ingestion', 'catalogue-service', 'recommendation-service', 'shopping-agent',
            'sre-copilot', 'payment-service', 'shipping-service', 'user-service', 'ai-gateway',
            'frontend', 'finder', 'nginx', 'mcp-server', 'cart-service']
APPS = {name for name in SERVICES if (ROOT / 'services' / name / 'Dockerfile').is_file()}
PASSWORD_KEYS = ['MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'SHIPPING_DB_PASSWORD',
                 'SHIPPING_APP_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD',
                 'PAYMENT_SERVICE_TOKEN', 'LLM_SERVICE_TOKEN', 'USER_SERVICE_TOKEN']


def render(output, prefix, tag, public_origin):
    import yaml  # Only manifest rendering requires PyYAML; credential setup uses stdlib.
    if not re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*[a-z0-9]', prefix):
        raise ValueError('Invalid IMAGE_PREFIX.')
    if tag != 'local':
        raise ValueError('Application image tag must be local.')
    if not re.fullmatch(r'https?://[a-zA-Z0-9.-]+(?::[0-9]+)?', public_origin):
        raise ValueError('PUBLIC_ORIGIN must be an HTTP(S) origin without a path.')
    output.mkdir(parents=True, exist_ok=True)
    docs = list(yaml.safe_load_all((ROOT / 'minikube/roboshop/config.yaml').read_text()))
    docs[1]['data']['PUBLIC_ORIGIN'] = public_origin
    (output / 'config.yaml').write_text(yaml.safe_dump_all(docs, sort_keys=False))
    (output / 'ingress.yaml').write_text((ROOT / 'minikube/roboshop/ingress.yaml').read_text())
    images = []
    for name in SERVICES:
        source = ROOT / 'services' / name / (name + '-minikube.yaml')
        docs = list(yaml.safe_load_all(source.read_text()))
        for item in docs:
            if item['metadata']['namespace'] != 'roboshop-ai':
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
    base = ['kubectl', '--context=' + context, '--request-timeout=30s', '-n', 'roboshop-ai']
    def read(args):
        result = subprocess.run(base + args, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Kubernetes read failed; verify context and RBAC.')
        return result.stdout.strip()
    current = read(['get', 'secret', 'roboshop-secrets', '--ignore-not-found', '-o', 'json'])
    if current:
        data = json.loads(current).get('data', {})
        if any(not data.get(key) for key in PASSWORD_KEYS if key != 'USER_SERVICE_TOKEN'):
            raise RuntimeError('Existing roboshop-secrets is incomplete; restore missing credentials rather than rotating database passwords.')
        email = base64.b64decode(data.get('SUPERADMIN_EMAIL', '')).decode()
        if email and email != 'team@jithendar.com':
            raise RuntimeError('Existing SUPERADMIN_EMAIL differs from team@jithendar.com; resolve explicitly.')
        additions = {}
        if not data.get('USER_SERVICE_TOKEN'):
            additions['USER_SERVICE_TOKEN'] = secrets.token_hex(32)
        if not email:
            additions['SUPERADMIN_EMAIL'] = 'team@jithendar.com'
        if not data.get('SUPERADMIN_PASSWORD'):
            additions['SUPERADMIN_PASSWORD'] = secrets.token_urlsafe(36)
        if additions:
            patch = [{'op':'test', 'path':'/metadata/resourceVersion', 'value':json.loads(current)['metadata']['resourceVersion']}]
            patch += [{'op':'add', 'path':'/data/'+key, 'value':base64.b64encode(value.encode()).decode()} for key,value in additions.items()]
            result = subprocess.run(base + ['patch','secret','roboshop-secrets','--type=json','--patch-file=/dev/stdin'], input=json.dumps(patch), text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError('Credential initialization conflicted or failed; retry. Values not printed.')
        print('Application and superadmin credentials ready; existing passwords preserved.')
        return
    claims = read(['get', 'pvc', 'mongodb-data', 'shipping-postgres', 'rabbitmq-data', 'gateway-data',
                   '--ignore-not-found', '-o', 'name'])
    if claims:
        raise RuntimeError('Existing data PVCs found without roboshop-secrets. Restore the original Secret before deploying.')
    payload = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 'roboshop-secrets', 'namespace': 'roboshop-ai'},
               'type': 'Opaque', 'stringData': {key: secrets.token_hex(32) for key in PASSWORD_KEYS}}
    payload['stringData'].update(SUPERADMIN_EMAIL='team@jithendar.com', SUPERADMIN_PASSWORD=secrets.token_urlsafe(36))
    result = subprocess.run(base + ['create', '-f', '-'], input=json.dumps(payload), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Could not create roboshop-secrets. Check permissions or concurrent installation; credentials were not printed.')
    print('Created roboshop-secrets with independent random credentials (values hidden).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    render_parser = commands.add_parser('render')
    render_parser.add_argument('--output', type=Path, required=True)
    render_parser.add_argument('--prefix', default=os.getenv('IMAGE_PREFIX', 'roboshop'))
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
