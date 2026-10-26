"""Small kubectl-only entry point for the repository's Argo CD catalog."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import yaml

ROOT = Path(__file__).resolve().parents[2]
# Current shop only. Legacy apps, optional AI apps and existing data services
# require an explicit name so this shortcut does not restore retired workloads.
ROBOSHOP = ['roboshop-config', 'currency-service', 'catalogue-service',
            'user-service', 'cart-service', 'payment-service', 'shipping-service',
            'ai-gateway', 'mcp-server', 'moks', 'frontend', 'nginx']


def catalog():
    resources = yaml.safe_load((ROOT / 'argocd/kustomization.yaml').read_text())['resources']
    docs = [yaml.safe_load((ROOT / 'argocd' / name).read_text()) for name in resources]
    return ({d['metadata']['name']: d for d in docs if d['kind'] == 'Application'},
            {d['metadata']['name']: d for d in docs if d['kind'] == 'AppProject'})


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=
        'Examples: ./deploy-argocd.sh roboshop | ./deploy-argocd.sh frontend nginx | '
        './deploy-argocd.sh status. Requires kubectl and Python with PyYAML. '
        'Apps deploy their configured Git revision; commit/push workload changes first.')
    parser.add_argument('apps', nargs='*', default=['all'],
                        help='App names, all, roboshop, list, or status (default: all)')
    parser.add_argument('--context', default=os.getenv('KUBE_CONTEXT', 'mk4'))
    parser.add_argument('--dry-run', action='store_true', help='Print selection without accessing the cluster')
    parser.add_argument('--timeout', type=int, default=600, help='Seconds to wait for Synced/Healthy (default 600)')
    args = parser.parse_args()
    apps, projects = catalog()
    if args.apps == ['list']:
        print('all: every Application registered in argocd/kustomization.yaml')
        print('roboshop: ' + ' '.join(ROBOSHOP))
        print('Available apps: ' + ' '.join(sorted(apps)))
        return
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    selected = list(dict.fromkeys(name for item in args.apps
                                  for name in (sorted(apps) if item == 'all' else
                                               ROBOSHOP if item == 'roboshop' else [item])))
    if args.apps != ['status']:
        unknown = set(selected) - apps.keys()
        if unknown:
            parser.error('Unknown apps: ' + ', '.join(sorted(unknown)))
    if args.dry_run:
        print(f'Context: {args.context}; action: ' + ' '.join(selected))
        print('Create missing projects/apps, preserve existing app settings, sync without pruning, wait for health.')
        return
    kube = ['kubectl', '--context', args.context, '--request-timeout=20s', '-n', 'argocd']

    def run(*command, body=None):
        return subprocess.check_output(kube + list(command), text=True,
                                       input=json.dumps(body) if body is not None else None)

    if args.apps == ['status']:
        print(run('get', 'applications'), end='')
        return
    live = {d['metadata']['name']: d for d in json.loads(run('get', 'applications', '-o', 'json'))['items']}
    # Check all selections before making any change.
    for name in selected:
        if live.get(name, {}).get('operation'):
            raise RuntimeError(f'{name}: a sync is already running; wait and retry')
    for project in sorted({live.get(n, apps[n])['spec']['project'] for n in selected}):
        if not run('get', 'appproject', project, '--ignore-not-found', '-o', 'name').strip():
            print(run('create', '-f', '-', body=projects[project]), end='')
    for name in selected:
        if name not in live:
            print(run('create', '-f', '-', body=apps[name]), end='')
        print(run('patch', 'application', name, '--type=merge', '--patch-file=/dev/stdin',
                  body={'operation': {'initiatedBy': {'username': 'deploy-argocd'},
                                      'sync': {'prune': False}}}), end='')
    deadline = time.monotonic() + args.timeout
    pending = set(selected)
    while pending and time.monotonic() < deadline:
        current = {d['metadata']['name']: d for d in json.loads(run('get', 'applications', '-o', 'json'))['items']}
        for name in sorted(pending):
            app = current.get(name, {})
            status = app.get('status', {})
            operation = status.get('operationState', {})
            if not app.get('operation') and operation.get('phase') in ('Failed', 'Error'):
                raise RuntimeError(f'{name}: {operation.get("message", operation["phase"])}')
            if (not app.get('operation') and operation.get('phase') == 'Succeeded'
                    and status.get('sync', {}).get('status') == 'Synced'
                    and status.get('health', {}).get('status') == 'Healthy'):
                print(f'{name}: Synced / Healthy', flush=True)
                pending.remove(name)
        if pending:
            time.sleep(min(5, max(0, deadline - time.monotonic())))
    if pending:
        raise RuntimeError('Timed out waiting for: ' + ', '.join(sorted(pending)) +
                           '. Inspect Argo CD events/logs; syncs were not cancelled.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
