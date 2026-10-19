"""Offline rendering and orchestration checks; no live cluster required."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).parent.resolve()


class PrometheusTests(unittest.TestCase):
    def test_paths_auth_storage_and_datasource(self):
        rendered = subprocess.check_output(['helm', 'template', 'prometheus', str(ROOT / 'prometheus'),
                                             '-n', 'robotshop-ai'], text=True)
        items = {x['kind']: x for x in yaml.safe_load_all(rendered) if x}
        ingress = items['Ingress']
        self.assertEqual(ingress['spec']['rules'][0]['http']['paths'][0]['path'], '/prometheus')
        self.assertEqual(ingress['spec']['tls'][0]['secretName'], 'jithendar-com-tls')
        self.assertEqual(ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.middlewares'],
                         'robotshop-ai-prometheus-auth@kubernetescrd')
        self.assertEqual(items['Middleware']['spec']['basicAuth']['secret'], 'prometheus-auth')
        container = items['Deployment']['spec']['template']['spec']['containers'][0]
        self.assertIn('--web.route-prefix=/prometheus', container['args'])
        self.assertIn('--web.external-url=https://jithendar.com/prometheus/', container['args'])
        self.assertEqual(container['readinessProbe']['httpGet']['path'], '/prometheus/-/ready')
        config = yaml.safe_load(items['ConfigMap']['data']['prometheus.yml'])
        self.assertEqual(config['scrape_configs'][0]['metrics_path'], '/prometheus/metrics')
        self.assertEqual(items['Service']['spec']['type'], 'ClusterIP')
        self.assertEqual(items['PersistentVolumeClaim']['spec']['resources']['requests']['storage'], '5Gi')
        grafana = yaml.safe_load((ROOT / 'grafana/values.yaml').read_text())
        ds = grafana['datasources']['datasources.yaml']['datasources'][0]
        self.assertEqual(ds['url'], 'http://prometheus.robotshop-ai.svc.cluster.local:9090/prometheus')

    def run_installer(self, crd_exit=0):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            bindir = home / '.local/bin'
            bindir.mkdir(parents=True)
            for name in ('helm', 'kubectl'):
                p = bindir / name
                p.write_text('#!/bin/sh\n'
                    f'echo "{name} $*" >> "$TEST_LOG"\n'
                    'case "$*" in\n'
                    ' *"get crd middlewares.traefik.io"*) exit "$CRD_EXIT";;\n'
                    ' *"get secret prometheus-auth"*) echo secret/prometheus-auth;;\n'
                    ' *"apply -f -"*) cat >/dev/null;;\n'
                    'esac\n')
                p.chmod(0o755)
            script = home / 'deploy.sh'
            script.write_text((ROOT / 'deploy-prometheus.sh').read_text().replace(
                '/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))
            result = subprocess.run(['bash', str(script)], text=True, capture_output=True,
                env={**os.environ, 'HOME': tmp, 'KUBE_CONTEXT': 'remote',
                     'TEST_LOG': str(home / 'calls'), 'CRD_EXIT': str(crd_exit)})
            return result, (home / 'calls').read_text()

    def test_reuses_password_and_checks_certificate(self):
        result, calls = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--kube-context=remote upgrade --install prometheus', calls)
        self.assertIn('certificate/jithendar-com', calls)
        self.assertNotIn('create -f ', calls)

    def test_missing_middleware_crd_prevents_install(self):
        result, calls = self.run_installer(1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)


if __name__ == '__main__':
    unittest.main()
