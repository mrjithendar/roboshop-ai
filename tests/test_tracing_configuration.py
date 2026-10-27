from pathlib import Path
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[1]
class Config(unittest.TestCase):
 def test_collector_owns_its_configuration_in_observability(self):
  data=yaml.safe_load((ROOT/'minikube/roboshop/roboshop-config-configmap.yaml').read_text())['data']
  self.assertNotIn('config.yaml',data)
  self.assertEqual(data['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'],'http://otel-collector.observability.svc.cluster.local:4318/v1/traces')
  kustomization=yaml.safe_load((ROOT/'observability/otel-collector/kustomization.yaml').read_text())
  self.assertEqual(kustomization['configMapGenerator'][0]['files'],['config.yaml=collector.yaml'])
  alias=yaml.safe_load((ROOT/'observability/otel-collector/roboshop-ai-otel-collector-service-minikube.yaml').read_text())
  self.assertEqual((alias['metadata']['namespace'],alias['spec']['type']),('roboshop-ai','ExternalName'))
 def test_new_exporters_receive_shared_configuration(self):
  for service in ('currency-service','kafka-bridge'):
   docs=(yaml.safe_load(p.read_text()) for p in (ROOT/f'services/{service}').glob('*-minikube.yaml'))
   containers=[c for d in docs if d['kind'] in ('Deployment','StatefulSet') for c in d['spec']['template']['spec']['containers'] if c['name']==service]
   self.assertEqual(len(containers),1)
   self.assertIn({'configMapRef':{'name':'roboshop-config'}},containers[0]['envFrom'])
