"""Offline deployment-contract tests; never contact Kubernetes or Docker."""
import importlib.util
import json
from pathlib import Path
import subprocess
import shutil
import os
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deployment', ROOT / 'minikube/robotshop/deployment.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ManifestTests(unittest.TestCase):
    def test_every_runnable_service_has_manifest(self):
        runnable = {p.parent.name for p in (ROOT / 'services').glob('*/compose.yml') if p.parent.name != 'common'}
        self.assertEqual(runnable, set(deploy.SERVICES))
        for name in runnable:
            self.assertTrue((ROOT / 'services' / name / (name + '-minikube.yaml')).is_file())

    def test_references_storage_probes_and_secret_expansion(self):
        items=[]
        for name in deploy.SERVICES:
            items.extend(yaml.safe_load_all((ROOT / 'services' / name / (name+'-minikube.yaml')).read_text()))
        items.extend(yaml.safe_load_all((ROOT / 'minikube/robotshop/config.yaml').read_text()))
        objects={(x['kind'], x['metadata']['name']):x for x in items}
        seen=set()
        for item in items:
            ident=(item['kind'],item['metadata']['name'])
            self.assertNotIn(ident,seen);seen.add(ident)
            if item['kind']=='Namespace': continue
            self.assertEqual(item['metadata']['namespace'],'robotshop-ai')
            self.assertNotIn(item['kind'],('Ingress','Secret','ClusterRole','ClusterRoleBinding'))
            if item['kind'] not in ('Deployment','StatefulSet'):continue
            pod=item['spec']['template']['spec'];volumes={v['name']:v for v in pod.get('volumes',[])}
            self.assertFalse(pod['automountServiceAccountToken'])
            for v in volumes.values():
                if 'persistentVolumeClaim' in v:self.assertIn(('PersistentVolumeClaim',v['persistentVolumeClaim']['claimName']),objects)
                if 'configMap' in v:self.assertIn(('ConfigMap',v['configMap']['name']),objects)
            for c in pod['containers']+pod.get('initContainers',[]):
                for m in c.get('volumeMounts',[]):self.assertIn(m['name'],volumes)
                known=set()
                for e in c.get('env',[]):
                    if 'valueFrom' in e:
                        ref=e['valueFrom']['secretKeyRef']
                        self.assertEqual(ref['name'],'robotshop-secrets')
                        self.assertTrue(ref.get('optional') or ref['key'] in deploy.PASSWORD_KEYS)
                    if 'value' in e:
                        import re
                        for ref in re.findall(r'\$\(([^)]+)\)',e['value']):self.assertIn(ref,known)
                    known.add(e['name'])
                if c.get('ports'):
                    self.assertIn('readinessProbe',c)
                    self.assertIn('startupProbe',c)
        rabbit=objects['StatefulSet','rabbitmq']
        self.assertEqual(rabbit['spec']['serviceName'],'rabbitmq')
        self.assertTrue(objects['Deployment','mcp-server']['spec']['template']['spec']['containers'][0]['stdin'])
        for service in (x for x in items if x['kind']=='Service'):
            name=service['metadata']['name']
            work=objects.get(('Deployment',name),objects.get(('StatefulSet',name)))
            ports={p['containerPort'] for p in work['spec']['template']['spec']['containers'][0]['ports']}
            self.assertTrue(all(p['targetPort'] in ports for p in service['spec']['ports']))

    def test_image_overrides_and_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            deploy.render(Path(tmp),'registry.example.com/team/robotshop','v2','https://shop.example.com')
            docs=list(yaml.safe_load_all((Path(tmp)/'shipping-service-minikube.yaml').read_text()))
            pod=next(x for x in docs if x['kind']=='Deployment')['spec']['template']['spec']
            self.assertEqual(pod['containers'][0]['image'],'registry.example.com/team/robotshop-shipping:v2')
            self.assertEqual(len((Path(tmp)/'images.txt').read_text().splitlines()),10)
            self.assertEqual(list(yaml.safe_load_all((Path(tmp)/'config.yaml').read_text()))[1]['data']['PUBLIC_ORIGIN'],'https://shop.example.com')

    def run_wrapper(self, fail_service=''):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)
            shutil.copytree(ROOT/'minikube/robotshop',home/'minikube/robotshop')
            for name in deploy.SERVICES:
                target=home/'services'/name
                target.mkdir(parents=True)
                shutil.copy(ROOT/'services'/name/(name+'-minikube.yaml'),target)
                if name in deploy.APPS:(target/'Dockerfile').touch()
            source=(ROOT/'deploy-minikube.sh').read_text().replace('/usr/local/bin:$HOME/.local/bin:$PATH','$HOME/.local/bin:$PATH')
            (home/'deploy-minikube.sh').write_text(source)
            bindir=home/'.local/bin';bindir.mkdir(parents=True)
            tool=bindir/'kubectl'
            secret=json.dumps({'data':{key:'existing' for key in deploy.PASSWORD_KEYS}})
            tool.write_text('#!/bin/sh\n'
                'echo "$*" >> "$TEST_LOG"\n'
                'case "$*" in\n'
                ' *"get secret robotshop-secrets"*) echo \''+secret+'\';;\n'
                ' *"rollout status deployment/shipping-db"*) exit "${ROLLOUT_EXIT:-0}";;\n'
                'esac\n')
            tool.chmod(0o755)
            result=subprocess.run(['bash',str(home/'deploy-minikube.sh')],text=True,capture_output=True,
                env={**os.environ,'HOME':str(home),'KUBE_CONTEXT':'selected-cluster',
                     'PYTHONPATH':str(Path(yaml.__file__).resolve().parent.parent),
                     'TEST_LOG':str(home/'calls'),'ROLLOUT_EXIT':'1' if fail_service else '0'})
            self.assertTrue((home/'calls').exists(), result.stderr)
            return result,(home/'calls').read_text()

    def test_wrapper_deploys_all_workloads_in_order(self):
        result,calls=self.run_wrapper()
        self.assertEqual(result.returncode,0,result.stderr)
        rollouts=[line for line in calls.splitlines() if 'rollout status' in line]
        self.assertEqual(len(rollouts),16)
        self.assertTrue(all('--context=selected-cluster' in line for line in calls.splitlines()))
        self.assertLess(calls.index('rollout status deployment/shipping-db'),calls.index('rollout status deployment/shipping-service'))
        self.assertLess(calls.index('rollout status deployment/ai-gateway'),calls.index('rollout status deployment/nginx'))
        self.assertIn('rollout status statefulset/rabbitmq',calls)

    def test_wrapper_stops_on_failed_database(self):
        result,calls=self.run_wrapper('shipping-db')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('describe pods -l app=shipping-db',calls)
        self.assertNotIn('rollout status deployment/nginx',calls)
        self.assertNotIn(' delete ',calls)

    def test_existing_secret_is_preserved(self):
        value=json.dumps({'data':{key:'existing' for key in deploy.PASSWORD_KEYS}})
        with patch.object(deploy.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=value)) as run:
            deploy.ensure_credentials('test')
            self.assertEqual(run.call_count,1)

    def test_missing_secret_with_existing_volume_stops(self):
        with patch.object(deploy.subprocess,'run',side_effect=[SimpleNamespace(returncode=0,stdout=''),SimpleNamespace(returncode=0,stdout='pvc/mongodb-data')]) as run:
            with self.assertRaisesRegex(RuntimeError,'Existing data PVCs'):deploy.ensure_credentials('test')
            self.assertEqual(run.call_count,2)

    def test_fresh_credentials_are_not_in_command_arguments(self):
        with patch.object(deploy.subprocess,'run',side_effect=[SimpleNamespace(returncode=0,stdout=''),SimpleNamespace(returncode=0,stdout=''),SimpleNamespace(returncode=0,stdout='')]) as run:
            deploy.ensure_credentials('test')
            payload=json.loads(run.call_args.kwargs['input'])
            self.assertEqual(set(payload['stringData']),set(deploy.PASSWORD_KEYS))
            for value in payload['stringData'].values():
                self.assertEqual(len(value),64)
                self.assertNotIn(value,str(run.call_args.args))


if __name__=='__main__':unittest.main()
