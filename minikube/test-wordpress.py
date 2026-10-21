"""Offline chart and deployment safety checks; no cluster changes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).parent.resolve()
spec = importlib.util.spec_from_file_location('routes', ROOT / 'wordpress/check-routes.py')
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class WordPressTests(unittest.TestCase):
    def test_root_conflict_and_grafana_coexistence(self):
        def ingress(name, path, namespace='robotshop-ai'):
            return {'metadata': {'name': name, 'namespace': namespace},
                    'spec': {'rules': [{'host': 'jithendar.com', 'http': {'paths': [{'path': path}]}}]}}
        self.assertEqual(list(routes.conflicts({'items': [ingress('grafana', '/grafana'), ingress('wordpress', '/', 'jithendar-com')]})), [])
        self.assertEqual(list(routes.conflicts({'items': [ingress('robotshop', '/')]})), ['robotshop-ai/robotshop'])

    def test_chart_storage_tls_and_private_initial_install(self):
        def render(enabled):
            output = subprocess.check_output(['helm', 'template', 'wordpress', str(ROOT / 'wordpress'),
                                              '-n', 'jithendar-com', '--set', f'ingress.enabled={enabled}'], text=True)
            return [x for x in yaml.safe_load_all(output) if x]
        self.assertFalse(any(x['kind'] == 'Ingress' for x in render('false')))
        items = render('true')
        self.assertTrue(all(x['metadata']['namespace'] == 'jithendar-com' for x in items))
        cert = next(x for x in items if x['kind'] == 'Certificate')
        self.assertEqual(cert['spec']['dnsNames'], ['jithendar.com'])
        self.assertEqual(cert['spec']['secretName'], 'jithendar-com-tls')
        ingress = next(x for x in items if x['kind'] == 'Ingress')
        self.assertEqual(ingress['spec']['tls'][0]['secretName'], 'jithendar-com-tls')
        self.assertEqual(ingress['spec']['rules'][0]['http']['paths'][0]['path'], '/')
        self.assertEqual(len([x for x in items if x['kind'] == 'PersistentVolumeClaim']), 2)
        self.assertFalse(any(x['kind'] == 'Secret' for x in items))
        for svc in (x for x in items if x['kind'] == 'Service'):
            self.assertEqual(svc['spec'].get('type', 'ClusterIP'), 'ClusterIP')

    def run_installer(self, bootstrap_exit, legacy_data=False):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            bindir = home / '.local/bin'
            bindir.mkdir(parents=True)
            for name in ('helm', 'kubectl'):
                tool = bindir / name
                tool.write_text('#!/bin/sh\n'
                    f'echo "{name} $*" >> "$TEST_LOG"\n'
                    'case "$*" in\n'
                    ' *"-n robotshop-ai get pvc"*) if [ "$LEGACY_DATA" = yes ]; then echo persistentvolumeclaim/wordpress-mysql; fi;;\n'
                    ' *"get ingress --all-namespaces"*) echo \'{"items":[]}\';;\n'
                    ' *"get secret wordpress-credentials"*) echo secret/wordpress-credentials;;\n'
                    ' *"exec -i deployment/wordpress"*) cat >/dev/null; exit "$BOOTSTRAP_EXIT";;\n'
                    ' *"apply -f -"*) cat >/dev/null;;\n'
                    'esac\n')
                tool.chmod(0o755)
            # Keep relative helpers available, but force mock tools ahead of host tools.
            script = home / 'deploy-wordpress.sh'
            source = (ROOT / 'deploy-wordpress.sh').read_text()
            source = source.replace('SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
                                    'SCRIPT_DIR=' + "'" + str(ROOT).replace("'", "'\\''") + "'")
            script.write_text(source.replace('/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH'))
            env = {**os.environ, 'HOME': tmp, 'KUBE_CONTEXT': 'test-cluster',
                   'TEST_LOG': str(home / 'calls'), 'BOOTSTRAP_EXIT': str(bootstrap_exit), 'LEGACY_DATA': 'yes' if legacy_data else 'no'}
            result = subprocess.run(['bash', str(script)], env=env, text=True, capture_output=True)
            return result, (home / 'calls').read_text()

    def test_legacy_data_stops_before_mutation(self):
        result, calls = self.run_installer(0, legacy_data=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Existing WordPress data', result.stderr)
        self.assertNotIn('helm ', calls)
        self.assertNotIn('apply ', calls)

    def test_old_namespace_root_route_is_not_ignored(self):
        data = {'items': [{'metadata': {'namespace': 'robotshop-ai', 'name': 'wordpress'},
                          'spec': {'rules': [{'host': 'jithendar.com', 'http': {'paths': [{'path': '/'}]}}]}}]}
        self.assertEqual(list(routes.conflicts(data)), ['robotshop-ai/wordpress'])

    def test_failed_bootstrap_never_publishes(self):
        result, calls = self.run_installer(1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('ingress.enabled=true', calls)

    def test_success_publishes_after_cache_check_and_certificate(self):
        result, calls = self.run_installer(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(calls.index('exec -i deployment/wordpress'), calls.index('ingress.enabled=true'))
        self.assertLess(calls.index('certificate/jithendar-com'), calls.index('ingress.enabled=true'))
        self.assertIn('--namespace jithendar-com', calls)
        self.assertIn('-n jithendar-com exec', calls)
        self.assertNotIn('create -f ', calls)  # Existing credentials are reused.


if __name__ == '__main__':
    unittest.main()
