"""Reuse the existing site certificate without copying or printing private keys."""
import json
import os
from pathlib import Path
import subprocess

HOST = 'jithendar.com'
SOURCE = 'jithendar'
TARGETS = ('argocd', 'monitoring', 'roboshop-ai')


def tls_patch(ingress):
    if ingress.get('spec', {}).get('ingressClassName') != 'traefik':
        return []
    patches = []
    for i, tls in enumerate(ingress.get('spec', {}).get('tls', [])):
        if tls.get('hosts') == [HOST] and tls.get('secretName') == 'jithendar-com-tls':
            patches.append({'op':'remove', 'path':f'/spec/tls/{i}/secretName'})
    return patches


def main():
    base = ['kubectl', '--context='+os.getenv('KUBE_CONTEXT', 'mk4'), '--request-timeout=30s']
    def read(*args):
        return json.loads(subprocess.check_output(base + list(args) + ['-o','json']))
    def run(*args):
        subprocess.run(base + list(args), check=True)
    source = read('-n', SOURCE, 'get', 'certificate', 'jithendar-com')
    if source['spec'].get('dnsNames') != [HOST] or source['spec'].get('secretName') != 'jithendar-com-tls' or not any(c['type']=='Ready' and c['status']=='True' for c in source.get('status',{}).get('conditions',[])):
        raise SystemExit('Source jithendar/jithendar-com must be Ready and cover only jithendar.com. No changes made. Install WordPress first or restore its certificate.')
    stores = read('get','tlsstores.traefik.io','-A')['items']
    if any(s['metadata']['name']=='default' and s['metadata']['namespace']!=SOURCE for s in stores):
        raise SystemExit('Another default TLSStore exists; resolve that conflict before proceeding. No changes made.')
    # Preflight every read before modifying the routing or certificate resources.
    ingresses = read('get','ingress','-A')['items']
    certificates = read('get','certificates','-A')['items']
    run('apply','-f', str(Path(__file__).with_name('tlsstore.yaml')))
    for ingress in ingresses:
        ns = ingress['metadata']['namespace']
        if ns not in TARGETS:
            continue
        patch = tls_patch(ingress)
        if patch:
            # Resource-version check prevents overwriting concurrent ingress edits.
            patch.insert(0, {'op':'test','path':'/metadata/resourceVersion','value':ingress['metadata']['resourceVersion']})
            run('-n',ns,'patch','ingress',ingress['metadata']['name'],'--type=json','-p',json.dumps(patch))
    for cert in certificates:
        meta, spec = cert['metadata'], cert['spec']
        if meta['namespace'] in TARGETS and meta['name']=='jithendar-com' and spec.get('dnsNames')==[HOST] and spec.get('secretName')=='jithendar-com-tls':
            # Keep issued TLS Secrets; never remove data or expose private keys.
            run('-n',meta['namespace'],'delete','certificate',meta['name'],'--cascade=orphan')
    print('Shared TLS configured. cert-manager renews jithendar/jithendar-com; Traefik watches its Secret. Existing TLS Secrets were preserved.')


if __name__ == '__main__':
    main()
