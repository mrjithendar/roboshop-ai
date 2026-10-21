"""Upgrade adds only the new service credential, preserving existing database secrets."""
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deployment', Path(__file__).parent/'robotshop/deployment.py')
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)

class UserDeployment(unittest.TestCase):
    def test_existing_secret_gains_only_missing_user_token(self):
        old = {k:'existing-value' for k in deployment.PASSWORD_KEYS if k != 'USER_SERVICE_TOKEN'}
        current = {'metadata':{'resourceVersion':'42'},'data':old}
        with patch.object(deployment.subprocess,'run') as run:
            run.side_effect = [subprocess.CompletedProcess([],0,json.dumps(current)),subprocess.CompletedProcess([],0,'')]
            deployment.ensure_credentials('mk4')
        operations = json.loads(run.call_args.kwargs['input'])
        self.assertEqual(operations[0],{'op':'test','path':'/metadata/resourceVersion','value':'42'})
        self.assertEqual(operations[1]['path'],'/data/USER_SERVICE_TOKEN')
        self.assertEqual(len(base64.b64decode(operations[1]['value'])),64)
        self.assertEqual(len(operations),2)

    def test_existing_user_token_is_never_rotated(self):
        current = {'data':{k:'existing-value' for k in deployment.PASSWORD_KEYS}}
        with patch.object(deployment.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(current))) as run:
            deployment.ensure_credentials('mk4')
            self.assertEqual(run.call_count,1)

    def test_missing_database_secret_is_not_replaced(self):
        with patch.object(deployment.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps({'data':{}}))) as run:
            with self.assertRaises(RuntimeError): deployment.ensure_credentials('mk4')
            self.assertEqual(run.call_count,1)

    def test_render_includes_user_image_and_gateway_url(self):
        with tempfile.TemporaryDirectory() as directory:
            deployment.render(Path(directory),'robotshop','local','https://jithendar.com')
            self.assertIn('robotshop-user-service:local', (Path(directory)/'images.txt').read_text())
            self.assertIn('http://user-service:4109',(Path(directory)/'ai-gateway-minikube.yaml').read_text())

if __name__ == '__main__': unittest.main()
