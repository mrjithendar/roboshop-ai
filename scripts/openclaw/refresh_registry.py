#!/usr/bin/env python3
"""Validate ECR image access before replacing the OpenClaw pull credential."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).parent))
from manage import context, confirm, kube, ROOT

REGISTRY = '881026659929.dkr.ecr.us-east-1.amazonaws.com'
REGION = 'us-east-1'


def aws(args, profile=None):
    command = ['aws'] + (['--profile', profile] if profile else [])
    return subprocess.check_output(command + ['--region', REGION] + args, text=True).strip()


def validate_access(profile=None):
    identity = json.loads(aws(['sts', 'get-caller-identity', '--output', 'json'], profile))
    print('ECR caller:', identity['Arn'])
    workloads = (ROOT / 'minikube/openclaw/base/workloads.yaml').read_text()
    images = set(re.findall(re.escape(REGISTRY) + r'/([^\s@]+)@(sha256:[a-f0-9]{64})', workloads))
    if not images:
        raise RuntimeError('No pinned ECR images found in OpenClaw workloads')
    for repository, digest in sorted(images):
        try:
            result = json.loads(aws([
                'ecr', 'batch-get-image', '--registry-id', REGISTRY.split('.')[0],
                '--repository-name', repository, '--image-ids', 'imageDigest=' + digest,
                '--output', 'json',
            ], profile))
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                'ECR image access denied or unavailable; existing pull secret was preserved. '
                'Use --profile for an authorized identity, or apply the repository pull policy '
                'in account 881026659929 and grant the caller ECR pull permissions.'
            ) from exc
        if result.get('failures') or not result.get('images'):
            raise RuntimeError(f'ECR image unavailable: {repository}@{digest}; existing pull secret was preserved')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ci', action='store_true')
    parser.add_argument('--profile', default=os.getenv('OPENCLAW_ECR_PROFILE') or None)
    args = parser.parse_args()
    ctx = context()
    if not kube('get', 'namespace', 'openclaw', '--ignore-not-found', '-o', 'name').strip():
        raise RuntimeError('OpenClaw namespace is missing. Apply minikube/openclaw/base/namespace.yaml first.')
    if args.ci:
        if os.getenv('GITHUB_ACTIONS') != 'true' or os.getenv('OPENCLAW_REGISTRY_REFRESH_ENABLED') != 'true':
            raise RuntimeError('CI credential refresh is not enabled')
    validate_access(args.profile)
    if not args.ci:
        confirm('refresh-registry')
    password = aws(['ecr', 'get-login-password'], args.profile)
    if not password:
        raise RuntimeError('ECR returned an empty password; existing pull secret was preserved')
    config = {'auths': {REGISTRY: {'auth': base64.b64encode(('AWS:' + password).encode()).decode()}}}
    secret = {'apiVersion': 'v1', 'kind': 'Secret',
              'metadata': {'name': 'openclaw-registry', 'namespace': 'openclaw'},
              'type': 'kubernetes.io/dockerconfigjson',
              'data': {'.dockerconfigjson': base64.b64encode(json.dumps(config).encode()).decode()}}
    subprocess.run(['kubectl', '--context', ctx, 'apply', '--server-side',
                    '--field-manager=openclaw-registry', '-f', '-'],
                   input=json.dumps(secret), text=True, check=True, stdout=subprocess.DEVNULL)
    print('OpenClaw pull credential refreshed; values were not printed. ECR credentials expire after 12 hours.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
