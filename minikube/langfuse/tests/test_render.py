"""Run after helm template, passing the rendered manifest as the argument."""
import sys
import unittest
from pathlib import Path
import yaml

resources = {r['metadata']['name']: r for r in yaml.safe_load_all(Path(sys.argv.pop(1)).read_text()) if r and r['kind'] in ('StatefulSet', 'Deployment')}

class RenderTests(unittest.TestCase):
    def test_permissions_before_database_initialization(self):
        for name, uid, volume in [('langfuse-postgresql',999,'postgres-data'), ('langfuse-redis',1000,'valkey-data')]:
            spec = resources[name]['spec']['template']['spec']
            init = spec['initContainers'][0]
            self.assertEqual(init['name'], 'prepare-data-permissions')
            self.assertIn(f'chown -R {uid}:{uid}', init['command'][2])
            self.assertEqual(init['volumeMounts'][0]['name'],volume)
            self.assertGreater(len(spec['initContainers']),1)

    def test_web_subpath_and_pull_credentials(self):
        spec = resources['langfuse-web']['spec']['template']['spec']
        web = spec['containers'][0]
        self.assertTrue(web['image'].endswith('/roboshop-langfuse:4.63.0-subpath'))
        self.assertEqual(spec['imagePullSecrets'],[{'name':'ecr-pull'}])
        for probe in ('livenessProbe','readinessProbe'):
            self.assertTrue(web[probe]['httpGet']['path'].startswith('/langfuse/'))
        env = {e['name']:e.get('value') for e in web['env']}
        self.assertEqual(env['NEXTAUTH_URL'],'https://jithendar.com/langfuse/api/auth')

    def test_other_workloads_unchanged(self):
        for name in ('langfuse-web','langfuse-worker','langfuse-s3-all-in-one'):
            self.assertNotIn('prepare-data-permissions',[c['name'] for c in resources[name]['spec']['template']['spec'].get('initContainers',[])])

if __name__ == '__main__':
    unittest.main()
