"""Install cluster controllers in order; never implicitly deploy business apps."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CONTROLLERS = (
    ('cert-manager', 'https://charts.jetstack.io', 'v1.20.4', 'cert-manager'),
    ('traefik', 'https://traefik.github.io/charts', '42.0.0', 'traefik'),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', default='mk4')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--deploy-apps', action='store_true', help='Deploy the default application catalog after bootstrap')
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error('--timeout must be positive')
    if args.dry_run:
        print(f'Context {args.context}: cert-manager -> Traefik -> Argo CD -> Argo CD ingress')
        print('Existing Helm releases are reused; no upgrades or ownership adoption.')
        if args.deploy_apps:
            print('Then deploy the Argo CD application catalog.')
        return
    for tool in ('helm', 'kubectl'):
        if not shutil.which(tool):
            raise RuntimeError(f'{tool} is required')
    kube = ['kubectl', '--context', args.context, '--request-timeout=20s']
    def read(*parts):
        return subprocess.check_output(kube + list(parts), text=True)
    # Preserve existing Argo ownership, including partially installed CRDs.
    cert_managed_by_argo = False
    read('get', 'namespace', 'kube-system', '-o', 'name')
    if read('get', 'crd', 'applications.argoproj.io', '--ignore-not-found', '-o', 'name').strip():
        owned = read('-n', 'argocd', 'get', 'application', 'cert-manager', '--ignore-not-found', '-o', 'name')
        if owned.strip():
            cert_managed_by_argo = True
    help_text = subprocess.check_output(['helm', 'list', '--help'], text=True)
    flags = ['--all'] if re.search(r'(?m)^\s*(?:-a,\s*)?--all\s', help_text) else []
    for name, repo, version, namespace in CONTROLLERS:
        if name == 'cert-manager' and cert_managed_by_argo:
            print('Completing existing Argo-managed cert-manager; Helm ownership is unchanged.', flush=True)
            subprocess.check_call([sys.executable, str(ROOT / 'scripts/argocd/deploy.py'), 'cert-manager', '--context', args.context, '--timeout', str(args.timeout)])
            continue
        helm = ['helm', '--kube-context', args.context, '--namespace', namespace]
        releases = json.loads(subprocess.check_output(helm + ['list', *flags, '--filter', f'^{name}$', '-o', 'json'], text=True))
        if releases:
            if releases[0]['status'] != 'deployed':
                raise RuntimeError(f'{name}: existing release is not deployed; inspect helm status. No automatic replacement.')
            print(f'Reusing {name}; version and values preserved.', flush=True)
        else:
            marker = ('crd', 'certificates.cert-manager.io') if name == 'cert-manager' else ('ingressclass', 'traefik')
            if read('get', *marker, '--ignore-not-found', '-o', 'name').strip():
                raise RuntimeError(f'{name}: existing resources without the expected Helm release; refusing adoption.')
            subprocess.check_call(helm + ['install', name, name, '--repo', repo, '--version', version,
                '--create-namespace', '--values', str(ROOT / 'minikube' / name / 'values.yaml'),
                '--wait', '--timeout', f'{args.timeout}s'])
        deployments = ['cert-manager', 'cert-manager-webhook', 'cert-manager-cainjector'] if name == 'cert-manager' else ['traefik']
        for deployment in deployments:
            subprocess.check_call(kube + ['-n', namespace, 'rollout', 'status', f'deployment/{deployment}', f'--timeout={args.timeout}s'])
    # Reuse the existing pinned, Helm-version-compatible Argo installer.
    subprocess.check_call([sys.executable, str(ROOT / 'scripts/argocd/deploy.py'), 'install', '--context', args.context, '--timeout', str(args.timeout)])
    subprocess.check_call(kube + ['apply', '-f', str(ROOT / 'minikube/argocd/ingress.yaml')])
    print('Controllers and Argo CD ingress ready. Public HTTPS still requires host ports 80/443 and the shared certificate.')
    if args.deploy_apps:
        subprocess.check_call([sys.executable, str(ROOT / 'scripts/argocd/deploy.py'), '--context', args.context, '--timeout', str(args.timeout)])


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
