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

    def test_workflow_stops_old_writer_before_applying_new_controller(self):
        workflow=yaml.safe_load((ROOT/'.github/workflows/deploy-minikube.yml').read_text())
        commands='\n'.join(s.get('run','') for s in workflow['jobs']['deploy']['steps'])
        stop=commands.index('delete deployment/mongodb')
        apply=commands.index('for service in mongodb')
        self.assertLess(stop,apply)
        self.assertIn('--cascade=foreground --wait=true --timeout=120s',commands[stop:apply])
        self.assertNotIn('delete pvc',commands)
