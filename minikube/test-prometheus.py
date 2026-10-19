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
        rendered = subprocess.check_output(['helm', 'template', 'prometheus', str(ROOT / 'monitoring/prometheus'),
                                             '-n', 'monitoring'], text=True)
        items = {x['kind']: x for x in yaml.safe_load_all(rendered) if x}
        self.assertNotIn('Certificate', items)  # Shared manifest, not chart-owned TLS.
        ingress = items['Ingress']
        self.assertEqual(ingress['spec']['rules'][0]['http']['paths'][0]['path'], '/prometheus')
        self.assertEqual(ingress['spec']['tls'][0]['secretName'], 'jithendar-com-tls')
        self.assertEqual(ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.middlewares'],
                         'monitoring-prometheus-auth@kubernetescrd')
        self.assertEqual(items['Middleware']['spec']['basicAuth']['secret'], 'monitoring-auth')
        container = items['Deployment']['spec']['template']['spec']['containers'][0]
        self.assertIn('--web.route-prefix=/prometheus', container['args'])
        self.assertIn('--web.external-url=https://jithendar.com/prometheus/', container['args'])
        self.assertEqual(container['readinessProbe']['httpGet']['path'], '/prometheus/-/ready')
        config = yaml.safe_load(items['ConfigMap']['data']['prometheus.yml'])
        self.assertEqual(config['scrape_configs'][0]['metrics_path'], '/prometheus/metrics')
        self.assertEqual(items['Service']['spec']['type'], 'ClusterIP')
        self.assertEqual(items['PersistentVolumeClaim']['spec']['resources']['requests']['storage'], '5Gi')
        grafana = yaml.safe_load((ROOT / 'monitoring/grafana/values.yaml').read_text())
        ds = grafana['datasources']['datasources.yaml']['datasources'][0]
        self.assertEqual(ds['url'], 'http://prometheus.monitoring.svc.cluster.local:9090/prometheus')

    def test_volume_repair_keeps_server_non_root_and_existing_claim(self):
        def render(enabled):
            output = subprocess.check_output(['helm', 'template', 'prometheus', str(ROOT / 'monitoring/prometheus'),
                '-n', 'monitoring', '--set', f'volumePermissions.enabled={enabled}'], text=True)
            return next(x for x in yaml.safe_load_all(output) if x and x['kind'] == 'Deployment')
        pod = render('true')['spec']['template']['spec']
        self.assertEqual(pod['securityContext']['runAsUser'], 65534)
        self.assertTrue(pod['securityContext']['runAsNonRoot'])
        init = pod['initContainers'][0]
        self.assertEqual(init['securityContext']['runAsUser'], 0)
        self.assertFalse(init['securityContext']['runAsNonRoot'])
        self.assertFalse(init['securityContext']['allowPrivilegeEscalation'])
        self.assertEqual(init['volumeMounts'], [{'name': 'data', 'mountPath': '/prometheus-data'}])
        self.assertIn('chown -R 65534:65534 /prometheus-data', init['command'][-1])
        self.assertIn('chmod -R u+rwX /prometheus-data', init['command'][-1])
        self.assertEqual(next(v for v in pod['volumes'] if v['name'] == 'data')['persistentVolumeClaim']['claimName'],
                         'prometheus-data')
        self.assertNotIn('initContainers', render('false')['spec']['template']['spec'])

    def run_installer(self, crd_exit=0, legacy_data=False, rollout_exit=0, helm_exit=0):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            bindir = home / '.local/bin'
            bindir.mkdir(parents=True)
            for name in ('helm', 'kubectl'):
                p = bindir / name
                p.write_text('#!/bin/sh\n'
                    f'echo "{name} $*" >> "$TEST_LOG"\n'
                    'case "$*" in\n'
                    ' *"-n robotshop-ai get deployment/prometheus"*) if [ "$LEGACY_DATA" = yes ]; then echo pvc/prometheus-data; fi;;\n'
                    ' *"upgrade --install prometheus"*) exit "$HELM_EXIT";;\n'
                    ' *"rollout status deployment/prometheus"*) exit "$ROLLOUT_EXIT";;\n'
                    ' *"get crd middlewares.traefik.io"*) exit "$CRD_EXIT";;\n'
                    ' *"get secret monitoring-auth"*) echo \'{"type":"kubernetes.io/basic-auth","data":{"username":"YWRtaW4=","password":"dGVzdA=="}}\';;\n'
                    ' *"apply -f -"*) cat >/dev/null;;\n'
                    'esac\n')
                p.chmod(0o755)
            (home / 'monitoring').mkdir()
            (home / 'monitoring/credentials.py').write_text((ROOT / 'monitoring/credentials.py').read_text())
            script = home / 'deploy.sh'
            script.write_text((ROOT / 'deploy-prometheus.sh').read_text().replace(
                '/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))
            result = subprocess.run(['bash', str(script)], text=True, capture_output=True,
                env={**os.environ, 'HOME': tmp, 'KUBE_CONTEXT': 'remote',
                     'TEST_LOG': str(home / 'calls'), 'CRD_EXIT': str(crd_exit), 'LEGACY_DATA': 'yes' if legacy_data else 'no', 'ROLLOUT_EXIT': str(rollout_exit), 'HELM_EXIT': str(helm_exit)})
            return result, (home / 'calls').read_text()

    def test_reuses_password_and_checks_certificate(self):
        result, calls = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--kube-context=remote upgrade --install prometheus', calls)
        self.assertIn('certificate/jithendar-com', calls)
        self.assertIn('--namespace monitoring', calls)
        self.assertIn('/monitoring/prometheus --namespace monitoring', calls)
        self.assertIn('monitoring/certificate.yaml', calls)
        self.assertNotIn('create -f ', calls)

    def test_rollout_failure_reports_diagnostics_not_success(self):
        result, calls = self.run_installer(rollout_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('describe pvc prometheus-data', calls)
        self.assertIn('logs deployment/prometheus', calls)
        self.assertIn('did not become ready', result.stderr)
        self.assertNotIn('Prometheus is ready at', result.stdout)

    def test_helm_failure_reports_diagnostics(self):
        result, calls = self.run_installer(helm_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Helm could not apply', result.stderr)
        self.assertIn('describe pods', calls)
        self.assertNotIn('rollout status', calls)

    def test_old_namespace_data_prevents_install(self):
        result, calls = self.run_installer(legacy_data=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Existing prometheus resources', result.stderr)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)

    def test_missing_middleware_crd_prevents_install(self):
        result, calls = self.run_installer(1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)


if __name__ == '__main__':
    unittest.main()
