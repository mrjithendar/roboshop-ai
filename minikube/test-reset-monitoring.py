"""Mock destructive commands; no real Kubernetes/Helm operations are performed."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).parent


class ResetMonitoringTests(unittest.TestCase):
    def run_reset(self, **overrides):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            bindir = home / '.local/bin'
            bindir.mkdir(parents=True)
            for name in ('kubectl', 'helm'):
                tool = bindir / name
                tool.write_text('#!/bin/sh\n'
                    f'echo "{name} $*" >> "$TEST_LOG"\n'
                    'case "$*" in\n'
                    ' *"get namespace kube-system"*) exit "${API_EXIT:-0}";;\n'
                    ' *"-n roboshop-ai get"*) if [ "${LEGACY:-no}" = yes ]; then echo pvc/grafana; fi;;\n'
                    ' *"list --namespace "*) if [ "${HAS_RELEASES:-yes}" = yes ]; then echo found; fi;;\n'
                    ' *"uninstall "*) exit "${UNINSTALL_EXIT:-0}";;\n'
                    ' *"delete pvc/"*) exit "${PVC_EXIT:-0}";;\n'
                    'esac\n')
                tool.chmod(0o755)
            script = home / 'reset.sh'
            script.write_text((ROOT / 'reset-monitoring.sh').read_text().replace(
                '/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))
            for app in ('prometheus', 'grafana'):
                (home / f'deploy-{app}.sh').write_text(
                    f'echo "reinstall {app} context=$KUBE_CONTEXT" >> "$TEST_LOG"\n')
            env = {**os.environ, 'HOME': tmp, 'KUBE_CONTEXT': 'remote',
                   'TEST_LOG': str(home / 'calls'), **overrides}
            result = subprocess.run(['bash', str(script)], env=env, text=True, capture_output=True)
            return result, (home / 'calls').read_text()

    def test_reset_scope_and_reinstall_order(self):
        result, calls = self.run_reset()
        self.assertEqual(result.returncode, 0, result.stderr)
        mutations = [line for line in calls.splitlines() if ' delete ' in line or ' uninstall ' in line]
        self.assertTrue(mutations)
        for line in mutations:
            self.assertTrue('monitoring' in line or 'roboshop-ai' in line)
            self.assertNotIn('jithendar', line)
            self.assertNotIn('delete namespace', line)
            self.assertNotIn('certificate', line)
        self.assertIn('delete pvc/grafana pvc/prometheus-data', calls)
        self.assertIn('delete secret/monitoring-auth secret/grafana secret/prometheus-auth', calls)
        self.assertLess(calls.index('delete pvc/'), calls.index('delete secret/'))
        self.assertLess(calls.index('delete secret/'), calls.index('reinstall prometheus context=remote'))
        self.assertLess(calls.index('reinstall prometheus'), calls.index('reinstall grafana context=remote'))

    def test_unreachable_cluster_never_deletes(self):
        result, calls = self.run_reset(API_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(' delete ', calls)
        self.assertNotIn(' uninstall ', calls)

    def test_legacy_resources_are_removed_before_reinstall(self):
        result, calls = self.run_reset(LEGACY='yes')
        self.assertEqual(result.returncode, 0, result.stderr)
        for namespace in ('roboshop-ai', 'monitoring'):
            self.assertIn(f'uninstall grafana --namespace {namespace}', calls)
            self.assertIn(f'uninstall prometheus --namespace {namespace}', calls)
            self.assertIn(f'-n {namespace} delete pvc/grafana pvc/prometheus-data', calls)
            self.assertIn(f'-n {namespace} delete secret/monitoring-auth secret/grafana secret/prometheus-auth', calls)
        self.assertLess(calls.index('-n monitoring delete pvc/'), calls.index('reinstall prometheus'))
        self.assertNotIn('delete namespace', calls)
        self.assertNotIn('delete --all', calls)
        self.assertNotIn('wordpress', calls)

    def test_uninstall_failure_preserves_pvcs(self):
        result, calls = self.run_reset(UNINSTALL_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('delete pvc/', calls)
        self.assertNotIn('reinstall ', calls)

    def test_failed_pvc_deletion_prevents_reinstall(self):
        result, calls = self.run_reset(PVC_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('delete secret/', calls)
        self.assertNotIn('reinstall ', calls)

    def test_absent_releases_still_clean_leftovers(self):
        result, calls = self.run_reset(HAS_RELEASES='no')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(' uninstall ', calls)
        self.assertIn('delete pvc/grafana pvc/prometheus-data', calls)
        self.assertIn('reinstall grafana', calls)


if __name__ == '__main__':
    unittest.main()
