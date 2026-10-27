from pathlib import Path
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[1]
class Config(unittest.TestCase):
 def test_embedded_collector_matches_source(self):
  config=yaml.safe_load((ROOT/'minikube/roboshop/roboshop-config-configmap.yaml').read_text())
  self.assertEqual(yaml.safe_load(config['data']['config.yaml']),yaml.safe_load((ROOT/'observability/opentelemetry/collector.yaml').read_text()))
 def test_new_exporters_receive_shared_configuration(self):
  for service in ('currency-service','kafka-bridge'):
   docs=(yaml.safe_load(p.read_text()) for p in (ROOT/f'services/{service}').glob('*-minikube.yaml'))
   containers=[c for d in docs if d['kind'] in ('Deployment','StatefulSet') for c in d['spec']['template']['spec']['containers'] if c['name']==service]
   self.assertEqual(len(containers),1)
   self.assertIn({'configMapRef':{'name':'roboshop-config'}},containers[0]['envFrom'])
