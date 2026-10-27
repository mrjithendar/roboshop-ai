from pathlib import Path
import subprocess
import unittest
import yaml

ROOT=Path(__file__).resolve().parents[1]

class LokiTests(unittest.TestCase):
    def test_render_and_boundaries(self):
        docs=list(yaml.safe_load_all(subprocess.check_output(['kubectl','kustomize',str(ROOT/'observability/loki')],text=True)))
        deployments=[d for d in docs if d['kind']=='Deployment']
        self.assertEqual({d['metadata']['name'] for d in deployments},{'loki','alloy'})
        self.assertFalse(any(d['kind'] in ('Ingress','IngressRoute','ClusterRole','Secret') for d in docs))
        for d in deployments:
            self.assertEqual(d['spec']['replicas'],1)
            pod=d['spec']['template']['spec']
            self.assertTrue(pod['securityContext']['runAsNonRoot'])
            self.assertFalse(any('hostPath' in v for v in pod['volumes']))
        roles=[d for d in docs if d['kind']=='Role']
        self.assertEqual({r['metadata']['namespace'] for r in roles},{'roboshop-ai','traefik'})
        self.assertTrue(all(set(rule['resources'])<={'pods','pods/log'} for r in roles for rule in r['rules']))

    def test_retention_and_sanitization(self):
        cfg=yaml.safe_load((ROOT/'observability/loki/loki.yaml').read_text())
        self.assertEqual(cfg['limits_config']['retention_period'],'168h')
        self.assertTrue(cfg['compactor']['retention_enabled'])
        alloy=(ROOT/'observability/loki/config.alloy').read_text()
        self.assertIn('stage.output { source = "safe_line" }',alloy)
        self.assertIn('wal { enabled = true }',alloy)
        self.assertNotIn('target_label = "trace_id"',alloy)

    def test_datasource_preserves_prometheus(self):
        cfg=yaml.safe_load((ROOT/'minikube/monitoring/grafana/values.yaml').read_text())
        ds=cfg['datasources']['datasources.yaml']['datasources']
        self.assertEqual({d['type'] for d in ds},{'prometheus','loki'})
        self.assertEqual([d['type'] for d in ds if d['isDefault']],['prometheus'])

if __name__=='__main__':unittest.main()
