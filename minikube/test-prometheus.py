"""Offline rendering and orchestration checks; no live cluster required."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from installer_test_helpers import prepare_source
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
        self.assertNotIn('secretName', ingress['spec']['tls'][0])  # shared Traefik TLSStore
        self.assertEqual(ingress['spec']['tls'][0]['hosts'], ['jithendar.com'])
        self.assertEqual(ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.middlewares'],
                         'monitoring-prometheus-auth@kubernetescrd')
        self.assertEqual(items['Middleware']['spec']['basicAuth']['secret'], 'monitoring-auth')
        container = items['Deployment']['spec']['template']['spec']['containers'][0]
        self.assertIn('--web.route-prefix=/prometheus', container['args'])
        self.assertIn('--web.external-url=https://jithendar.com/prometheus/', container['args'])
        self.assertEqual(container['readinessProbe']['httpGet']['path'], '/prometheus/-/ready')
        config = yaml.safe_load(items['ConfigMap']['data']['prometheus.yml'])
        self.assertEqual(config['scrape_configs'][0]['metrics_path'], '/prometheus/metrics')
        jobs = {j['job_name']: j for j in config['scrape_configs']}
        for name, suffix in [('kubernetes-kubelet', 'metrics'), ('kubernetes-cadvisor', 'metrics/cadvisor')]:
            job = jobs[name]
            self.assertEqual(job['scheme'], 'https')
            self.assertNotIn('insecure_skip_verify', job['tls_config'])
            self.assertEqual(job['relabel_configs'][-1]['replacement'], '/api/v1/nodes/$1/proxy/' + suffix)
        role = items['ClusterRole']
        self.assertFalse(any('secrets' in rule['resources'] for rule in role['rules']))
        self.assertEqual(items['ClusterRoleBinding']['subjects'][0]['namespace'], 'monitoring')
        self.assertEqual(items['Service']['spec']['type'], 'ClusterIP')
        self.assertEqual(items['PersistentVolumeClaim']['spec']['resources']['requests']['storage'], '5Gi')
        grafana = yaml.safe_load((ROOT / 'monitoring/grafana/values.yaml').read_text())
        ds = grafana['datasources']['datasources.yaml']['datasources'][0]
        self.assertEqual(ds['url'], 'http://prometheus.monitoring.svc.cluster.local:9090/prometheus')

    def test_openclaw_monitoring_is_opt_in_and_authenticated(self):
        rendered=subprocess.check_output(['helm','template','prometheus',str(ROOT/'monitoring/prometheus'),'-n','monitoring','--set','openclaw.enabled=true'],text=True)
        items={x['kind']:x for x in yaml.safe_load_all(rendered) if x}
        config=yaml.safe_load(items['ConfigMap']['data']['prometheus.yml'])
        jobs={j['job_name']:j for j in config['scrape_configs']}
        self.assertEqual(jobs['openclaw-operations']['authorization']['credentials_file'],'/var/run/openclaw-metrics/token')
        self.assertEqual(jobs['openclaw-gateway-telemetry']['metrics_path'],'/api/diagnostics/prometheus')
        self.assertIn('openclaw-alerts.yml',items['ConfigMap']['data'])
        pod=items['Deployment']['spec']['template']['spec']
        self.assertTrue(any(v.get('secret',{}).get('secretName')=='openclaw-metrics-auth' for v in pod['volumes']))

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
                    ' *"-n roboshop-ai get deployment/prometheus"*) if [ "$LEGACY_DATA" = yes ]; then echo pvc/prometheus-data; fi;;\n'
                    ' *"upgrade --install prometheus"*) exit "$HELM_EXIT";;\n'
                    ' *"rollout status deployment/prometheus"*) exit "$ROLLOUT_EXIT";;\n'
                    ' *"get crd middlewares.traefik.io"*) exit "$CRD_EXIT";;\n'
                    ' *"get secret monitoring-auth"*) echo \'{"type":"kubernetes.io/basic-auth","data":{"username":"YWRtaW4=","password":"dGVzdA=="}}\';;\n'
                    ' *"apply -f -"*) cat >/dev/null;;\n'
                    'esac\n')
                p.chmod(0o755)
            (home / 'monitoring').mkdir()
            (home / 'monitoring/credentials.py').write_text((ROOT / 'monitoring/credentials.py').read_text().replace("if _host_subprocess.call(['bash', str(_host_gate)]):", 'if False:  # host policy tested separately'))
            script = home / 'deploy.sh'
            # Host gating and shared TLS reconciliation have independent suites.
            source=(ROOT / 'deploy-prometheus.sh').read_text()
            source='\n'.join('roboshop_require_centos() { return 0; }' if line.startswith('source ') else line for line in source.splitlines())
            script.write_text(prepare_source(source).replace('/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))
            (home/'setup-shared-tls.sh').write_text('#!/bin/sh\necho "shared-tls reconcile" >> "$TEST_LOG"\n')
            result = subprocess.run(['bash', str(script)], text=True, capture_output=True,
                env={**os.environ, 'HOME': tmp, 'KUBE_CONTEXT': 'remote',
                     'TEST_LOG': str(home / 'calls'), 'CRD_EXIT': str(crd_exit), 'LEGACY_DATA': 'yes' if legacy_data else 'no', 'ROLLOUT_EXIT': str(rollout_exit), 'HELM_EXIT': str(helm_exit)})
            return result, (home / 'calls').read_text() if (home / 'calls').exists() else ''

    def test_reuses_password_and_checks_certificate(self):
        result, calls = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--kube-context=remote upgrade --install prometheus', calls)
        self.assertIn('certificate/jithendar-com', calls)
        self.assertIn('--namespace monitoring', calls)
        self.assertIn('/monitoring/prometheus --namespace monitoring', calls)
        self.assertIn('shared-tls reconcile', calls)
        self.assertNotIn('monitoring/certificate.yaml', calls)
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
