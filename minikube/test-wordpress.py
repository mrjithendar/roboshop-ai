"""Offline chart and deployment safety checks; no cluster changes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from installer_test_helpers import prepare_source
import yaml

ROOT = Path(__file__).parent.resolve()
spec = importlib.util.spec_from_file_location('routes', ROOT / 'wordpress/check-routes.py')
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class WordPressTests(unittest.TestCase):
    def test_root_conflict_and_grafana_coexistence(self):
        def ingress(name, path, namespace='roboshop-ai'):
            return {'metadata': {'name': name, 'namespace': namespace},
                    'spec': {'rules': [{'host': 'jithendar.com', 'http': {'paths': [{'path': path}]}}]}}
        self.assertEqual(list(routes.conflicts({'items': [ingress('grafana', '/grafana'), ingress('wordpress', '/', 'jithendar')]})), [])
        self.assertEqual(list(routes.conflicts({'items': [ingress('roboshop', '/')]})), ['roboshop-ai/roboshop'])

    def test_chart_storage_tls_and_private_initial_install(self):
        def render(enabled):
            output = subprocess.check_output(['helm', 'template', 'wordpress', str(ROOT / 'wordpress'),
                                              '-n', 'jithendar', '--set', f'ingress.enabled={enabled}'], text=True)
            return [x for x in yaml.safe_load_all(output) if x]
        self.assertFalse(any(x['kind'] == 'Ingress' for x in render('false')))
        items = render('true')
        self.assertTrue(all(x['metadata']['namespace'] == 'jithendar' for x in items))
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



    def test_old_namespace_root_route_is_not_ignored(self):
        data = {'items': [{'metadata': {'namespace': 'roboshop-ai', 'name': 'wordpress'},
                          'spec': {'rules': [{'host': 'jithendar.com', 'http': {'paths': [{'path': '/'}]}}]}}]}
        self.assertEqual(list(routes.conflicts(data)), ['roboshop-ai/wordpress'])




if __name__ == '__main__':
    unittest.main()
