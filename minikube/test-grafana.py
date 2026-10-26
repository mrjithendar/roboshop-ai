"""Exercise installer orchestration with mock commands; never contact a cluster."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from installer_test_helpers import prepare_source

SCRIPT = Path(__file__).with_name('deploy-grafana.sh')


class GrafanaTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        bindir = self.root / '.local/bin'
        bindir.mkdir(parents=True)
        for name in ('helm', 'kubectl'):
            tool = bindir / name
            tool.write_text(
                '#!/bin/sh\n'
                f'echo "{name} $*" >> "$TEST_LOG"\n'
                'case "$*" in\n'
                ' *"get secret monitoring-auth"*) echo \'{"type":"kubernetes.io/basic-auth","data":{"username":"YWRtaW4=","password":"dGVzdA=="}}\';;\n'
                ' *"exec -i deployment/grafana"*) cat >/dev/null;;\n'
                ' *"-n roboshop-ai get deployment/grafana"*) if [ "${LEGACY_DATA:-no}" = yes ]; then echo pvc/grafana; fi;;\n'
                ' *"get ingressclass traefik"*) exit "${INGRESS_EXIT:-0}";;\n'
                ' *"wait --for=condition=Ready certificate/jithendar-com"*) exit "${CERT_EXIT:-0}";;\n'
                ' *"apply -f -"*) cat >/dev/null;;\n'
                'esac\n'
            )
            tool.chmod(0o755)
        state = self.root / '.minikube/roboshop-installer'
        state.mkdir(parents=True)
        (state / 'mk4.profile').write_text('mk4-selected\n')
        self.env = {k: v for k, v in os.environ.items() if k not in (
            'PROFILE', 'KUBE_CONTEXT', 'MINIKUBE_HOME', 'GRAFANA_CHART_VERSION')}
        self.env.update(HOME=str(self.root), TEST_LOG=str(self.root / 'calls'))
        (self.root / 'monitoring').mkdir()
        (self.root / 'monitoring/credentials.py').write_text((SCRIPT.parent / 'monitoring/credentials.py').read_text().replace("if _host_subprocess.call(['bash', str(_host_gate)]):", 'if False:  # host policy tested separately'))
        self.script = self.root / 'deploy.sh'
        self.script.write_text(prepare_source(SCRIPT.read_text()).replace(
            '/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))

    def run_script(self, **env):
        result = subprocess.run(['bash', str(self.script)],
                                env={**self.env, **env}, capture_output=True, text=True)
        return result, (self.root / 'calls').read_text()

    def test_selected_profile_and_tls_readiness(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--kube-context=mk4-selected upgrade --install grafana', calls)
        self.assertIn('--version 14.0.1', calls)
        self.assertIn('--namespace monitoring', calls)
        self.assertIn('/monitoring/grafana/values.yaml', calls)
        self.assertIn('shared-tls reconcile', calls)
        self.assertIn('-n jithendar wait', calls)
        self.assertLess(calls.index('get ingressclass'), calls.index('apply -f'))
        self.assertLess(calls.index('upgrade --install'), calls.index('certificate/jithendar-com'))
        self.assertIn('https://jithendar.com/grafana/', result.stdout)
        self.assertNotIn('test', result.stdout)  # Credential values are never printed.

    def test_old_namespace_data_stops_before_mutation(self):
        result, calls = self.run_script(LEGACY_DATA='yes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Existing grafana resources', result.stderr)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)

    def test_missing_ingress_stops_before_mutation(self):
        result, calls = self.run_script(INGRESS_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)

    def test_certificate_failure_does_not_report_success(self):
        result, calls = self.run_script(CERT_EXIT='1', KUBE_CONTEXT='remote')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--kube-context=remote', calls)
        self.assertIn('HTTPS is not ready', result.stderr)
        self.assertNotIn('certificate are ready', result.stdout)


if __name__ == '__main__':
    unittest.main()
