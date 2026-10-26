import unittest
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[1]
class MongoManifestTests(unittest.TestCase):
    def test_statefulset_reuses_existing_claim_and_service(self):
        docs=list(yaml.safe_load_all((ROOT/'services/mongodb/mongodb-minikube.yaml').read_text()))
        self.assertFalse(any(d['kind']=='Deployment' for d in docs))
        sts=next(d for d in docs if d['kind']=='StatefulSet')
        self.assertEqual(sts['spec']['replicas'],1)
        self.assertNotIn('volumeClaimTemplates',sts['spec'])
        volumes=sts['spec']['template']['spec']['volumes']
        self.assertEqual(next(v for v in volumes if v['name']=='data')['persistentVolumeClaim']['claimName'],'mongodb-data')
        services={d['metadata']['name']:d for d in docs if d['kind']=='Service'}
        self.assertEqual(services[sts['spec']['serviceName']]['spec']['clusterIP'],'None')
        self.assertIn('mongodb',services)
