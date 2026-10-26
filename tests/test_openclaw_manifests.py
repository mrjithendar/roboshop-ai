"""Rendered GitOps and trust-boundary contracts; never mutates a cluster."""
import json
from pathlib import Path
import subprocess
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[1]
class Manifests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.objects=list(yaml.safe_load_all(subprocess.check_output(['kubectl','kustomize',str(ROOT/'minikube/openclaw/overlays/mk4')],text=True)))
 def test_single_gateway_ingress(self):
  ingresses=[d for d in self.objects if d['kind']=='Ingress']
  self.assertEqual(len(ingresses),1)
  self.assertEqual(ingresses[0]['metadata']['name'],'openclaw')
 def test_container_security(self):
  for d in self.objects:
   if d['kind']!='Deployment':continue
   p=d['spec']['template']['spec'];self.assertFalse(p['automountServiceAccountToken']);self.assertTrue(p['securityContext']['runAsNonRoot'])
   for c in p['containers']:
    self.assertFalse(c['securityContext']['allowPrivilegeEscalation']);self.assertTrue(c['securityContext']['readOnlyRootFilesystem'])
    self.assertEqual(c['securityContext']['capabilities']['drop'],['ALL'])
    self.assertIn('startupProbe',c);self.assertIn('readinessProbe',c);self.assertIn('livenessProbe',c)
 def test_rbac(self):
  self.assertFalse(any(d['kind'] in ('ClusterRole','ClusterRoleBinding') for d in self.objects))
  for d in self.objects:
   if d['kind']!='Role':continue
   for rule in d['rules']:
    self.assertLessEqual(set(rule['verbs']),{'get','list'})
    self.assertFalse(set(rule['resources']) & {'*','secrets','pods/exec','pods/attach','nodes/proxy'})
 def test_storage_retention(self):
  pvc=next(d for d in self.objects if d['kind']=='PersistentVolumeClaim')
  self.assertEqual(pvc['spec']['resources']['requests']['storage'],'10Gi')
  self.assertIn('Delete=false',pvc['metadata']['annotations']['argocd.argoproj.io/sync-options'])
 def test_network_default_deny(self):
  p=next(d for d in self.objects if d['kind']=='NetworkPolicy' and d['metadata']['name']=='default-deny')
  self.assertEqual(set(p['spec']['policyTypes']),{'Ingress','Egress'})
  self.assertNotIn('egress',p['spec'])
 def test_shared_tls_and_auth(self):
  docs=self.objects
  ingress=next(d for d in docs if d['kind']=='Ingress')
  self.assertNotIn('secretName',ingress['spec']['tls'][0])
  self.assertEqual('openclaw-openclaw-headers@kubernetescrd',ingress['metadata']['annotations']['traefik.ingress.kubernetes.io/router.middlewares'])
  config=json.loads((ROOT/'minikube/openclaw/base/openclaw.json').read_text())
  self.assertEqual(config['gateway']['auth']['mode'],'token')
  self.assertFalse(config['gateway']['controlUi'].get('dangerouslyDisableDeviceAuth',False))
  self.assertFalse(any('stripPrefix' in d.get('spec',{}) for d in docs))
  self.assertFalse(any(d['kind']=='Certificate' for d in docs))
 def test_pinned_official_image_and_agent_configuration(self):
  dep=next(d for d in self.objects if d['kind']=='Deployment' and d['metadata']['name']=='openclaw')
  self.assertIn('2026.10.7@sha256:',dep['spec']['template']['spec']['containers'][0]['image'])
  config=json.loads((ROOT/'minikube/openclaw/base/openclaw.json').read_text())
  self.assertEqual(config['gateway']['controlUi']['basePath'],'/openclaw')
  self.assertEqual(config['gateway']['auth']['mode'],'token')
  self.assertEqual(len(config['agents']['entries']),8)
  self.assertFalse(config['diagnostics']['otel']['captureContent'])
  for agent,entry in config['agents']['entries'].items():
   self.assertTrue(all(n.startswith('ops-'+agent+'__ops_') for n in entry['tools']['allow']))
if __name__=='__main__':unittest.main()
