"""Small kubectl-only entry point for the repository's Argo CD catalog."""
import argparse
import json
import os
import re
import shutil
from pathlib import Path
import subprocess
import sys
import time

import yaml

ROOT = Path(__file__).resolve().parents[2]
ARGOCD_CHART_VERSION = '10.10.5'
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
                        help='install, app names, all, roboshop, list, or status (default: all)')
    parser.add_argument('--context', default=os.getenv('KUBE_CONTEXT', 'mk4'))
    parser.add_argument('--dry-run', action='store_true', help='Print selection without accessing the cluster')
    parser.add_argument('--timeout', type=int, default=600, help='Seconds to wait for Synced/Healthy (default 600)')
    args = parser.parse_args()
    apps, projects = catalog()
    # Legacy explicit selection supports repairing an existing Argo-managed
    # cert-manager. It is never included by 'all' on a fresh Helm bootstrap.
    if 'cert-manager' in args.apps:
        apps['cert-manager'] = yaml.safe_load((ROOT / 'argocd/cert-manager.yaml').read_text())
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
    if 'install' in args.apps and args.apps != ['install']:
        parser.error('Run install separately before selecting applications')
    if args.apps not in (['status'], ['install']):
        unknown = set(selected) - apps.keys()
        if unknown:
            parser.error('Unknown apps: ' + ', '.join(sorted(unknown)))
    if args.dry_run:
        print(f'Context: {args.context}; action: ' + ' '.join(selected))
        if args.apps == ['install']:
            print(f'Install Argo CD chart {ARGOCD_CHART_VERSION} if absent; reuse existing Helm release. No applications or ingress deployed.')
        else:
            print('Install Argo CD if missing, create missing projects/apps, preserve existing app settings, sync without pruning, wait for health.')
        return
    kube = ['kubectl', '--context', args.context, '--request-timeout=20s', '-n', 'argocd']

    def run(*command, body=None):
        return subprocess.check_output(kube + list(command), text=True,
                                       input=json.dumps(body) if body is not None else None)

    def install_controller():
        if not shutil.which('helm'):
            raise RuntimeError('Helm is required to install Argo CD. Install Kubernetes Helm first.')
        helm = ['helm', '--kube-context', args.context, '--namespace', 'argocd']
        # Helm 3 needs --all to include pending/uninstalled releases; Helm 4
        # lists every status by default and removed that flag. Match the exact
        # option, not --all-namespaces, so an existing release is never hidden.
        list_help = subprocess.check_output(['helm', 'list', '--help'], text=True)
        status_flags = ['--all'] if re.search(r'(?m)^\s*(?:-a,\s*)?--all\s', list_help) else []
        releases = json.loads(subprocess.check_output(
            helm + ['list', *status_flags, '--filter', '^argocd$', '-o', 'json'], text=True))
        if releases:
            release_status = releases[0]['status']
            if release_status not in ('deployed', 'pending-install'):
                raise RuntimeError('Existing argocd Helm release is not deployed; inspect helm status argocd before retrying. No changes made.')
            if release_status == 'pending-install':
                print('Helm reports pending-install; verifying existing Argo CD workloads without changing release metadata.')
                for workload in ('deployment/argocd-server', 'deployment/argocd-repo-server',
                                 'deployment/argocd-redis', 'statefulset/argocd-application-controller'):
                    run('rollout', 'status', workload, f'--timeout={args.timeout}s')
                print('Existing controllers are ready. Helm remains pending-install; resolve that release state before future Helm upgrades.')
            print('Reusing existing Argo CD Helm release; values and version unchanged.')
        else:
            existing = run('get', 'crd', 'applications.argoproj.io', '--ignore-not-found', '-o', 'name')
            if existing.strip():
                raise RuntimeError('Argo CD CRDs already exist without the argocd Helm release. Refusing automatic adoption; inspect the existing installation.')
            subprocess.check_call(helm + [
                'install', 'argocd', 'argo-cd',
                '--repo', 'https://argoproj.github.io/argo-helm',
                '--version', ARGOCD_CHART_VERSION, '--create-namespace',
                '--values', str(ROOT / 'minikube/argocd/values.yaml'),
                '--wait', '--timeout', f'{args.timeout}s'])
        for crd in ('applications.argoproj.io', 'appprojects.argoproj.io'):
            run('wait', '--for=condition=Established', f'crd/{crd}', f'--timeout={args.timeout}s')
        print('Argo CD is installed. Public HTTPS ingress is configured separately.')

    if args.apps == ['install']:
        install_controller()
        return
    for crd in ('applications.argoproj.io', 'appprojects.argoproj.io'):
        if not run('get', 'crd', crd, '--ignore-not-found', '-o', 'name').strip():
            if args.apps == ['status']:
                raise RuntimeError(f'Argo CD is not installed in context {args.context}. Run ./deploy-argocd.sh to install and deploy.')
            print('Argo CD is missing; installing the controller before deploying applications.')
            install_controller()
            break
    if args.apps == ['status']:
        print(run('get', 'applications'), end='')
        return
    live = {d['metadata']['name']: d for d in json.loads(run('get', 'applications', '-o', 'json'))['items']}
    # Check all selections before making any change.
    for name in selected:
        if live.get(name, {}).get('operation'):
            raise RuntimeError(f'{name}: a sync is already running; wait and retry')
    # Create only selected destination namespaces, before any sync. Minimal
    # server-side manifests preserve existing labels/annotations and never prune.
    namespace_files = set()
    for name in selected:
        destination = live.get(name, apps[name])['spec'].get('destination', apps[name]['spec']['destination'])
        if destination.get('server') != 'https://kubernetes.default.svc':
            raise RuntimeError(f'{name}: remote destination requires namespace setup on its own cluster')
        namespace = destination['namespace']
        manifest = ROOT / 'minikube/namespaces' / f'{namespace}.yaml'
        if not manifest.is_file() or yaml.safe_load(manifest.read_text()) != {
                'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': namespace}}:
            raise RuntimeError(f'{name}: missing or invalid namespace manifest for {namespace}')
        namespace_files.add(manifest)
    for manifest in sorted(namespace_files):
        subprocess.check_call(kube + ['apply', '--server-side', '--field-manager=roboshop-namespace-bootstrap', '-f', str(manifest)])
    for project in sorted({live.get(n, apps[n])['spec']['project'] for n in selected}):
        if not run('get', 'appproject', project, '--ignore-not-found', '-o', 'name').strip():
            print(run('create', '-f', '-', body=projects[project]), end='')
    for name in selected:
        if name not in live:
            print(run('create', '-f', '-', body=apps[name]), end='')
        # Explicit operation requests must carry the Application's sync options.
        # In particular, fresh namespaces and server-side CRD application depend
        # on these; use live policy when present rather than overriding it.
        sync_options = live.get(name, apps[name]).get('spec', {}).get('syncPolicy', {}).get('syncOptions', [])
        print(run('patch', 'application', name, '--type=merge', '--patch-file=/dev/stdin',
                  body={'operation': {'initiatedBy': {'username': 'deploy-argocd'},
                                      'sync': {'prune': False, 'syncOptions': sync_options}}}), end='')
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
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
