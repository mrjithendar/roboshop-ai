#!/usr/bin/env python3
"""Prepare initial credentials locally; never apply or rotate live Secrets."""
import argparse
import getpass
import json
import os
from pathlib import Path
import secrets
import sys

AGENTS = ('orchestrator', 'sre', 'argocd', 'github', 'aws', 'observability', 'roboshop', 'blog')


def manifest(api_key):
    if not api_key.strip():
        raise ValueError('An OpenAI API key is required.')
    tokens = {agent: secrets.token_urlsafe(48) for agent in (*AGENTS, 'monitor')}
    gateway = secrets.token_urlsafe(48)
    def secret(namespace, name, data):
        return {'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
                'metadata': {'namespace': namespace, 'name': name}, 'stringData': data}
    return {'apiVersion': 'v1', 'kind': 'List', 'items': [
        secret('openclaw', 'openclaw-gateway-secrets', {
            'OPENAI_API_KEY': api_key.strip(), 'OPENCLAW_GATEWAY_TOKEN': gateway,
            **{'OPS_' + agent.upper() + '_TOKEN': tokens[agent] for agent in AGENTS}}),
        secret('openclaw', 'openclaw-operations-identities', {'identities.json': json.dumps(tokens)}),
        secret('monitoring', 'openclaw-metrics-auth', {'token': tokens['monitor'], 'gateway-token': gateway}),
    ]}


def write_manifest(output, data):
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    root = Path(__file__).resolve().parents[2]
    if output.is_relative_to(root):
        raise ValueError('Save credentials outside the repository.')
    if output.exists():
        raise ValueError('Output already exists; reuse that file instead of regenerating tokens.')
    if not sys.stdin.isatty():
        raise ValueError('Run interactively to enter the API key privately.')
    write_manifest(output, manifest(getpass.getpass('OpenAI API key (hidden): ')))
    print('Initial secret manifest saved with mode 0600:', output)
    print('No cluster changes made. Use kubectl create, not apply, for first provisioning; retain this file securely if a partial create needs recovery.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
