"""Static manifest checks and the actual Logstash Ruby filter, no cluster needed."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import yaml
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'observability/elk'


def render(layer):
    return [x for x in yaml.safe_load_all(subprocess.check_output(['kubectl','kustomize',str(BASE/layer)],text=True)) if x]


class ElkTests(unittest.TestCase):
    def test_render_and_security(self):
        if not shutil.which('kubectl'):self.skipTest('kubectl required for offline Kustomize rendering')
        docs=render('core')+render('pipeline')
        self.assertFalse(any(x['kind']=='Secret' for x in docs))
        self.assertFalse(any(x['kind']=='ClusterRole' for x in docs))
        ingress=next(x for x in docs if x['kind']=='IngressRoute')
        self.assertEqual(ingress['spec']['tls'],{})
        self.assertIn('Path(`/elk`)',ingress['spec']['routes'][0]['match'])
        self.assertNotIn('middlewares',ingress['spec']['routes'][0])
        kb=next(x for x in docs if x['kind']=='Kibana')
        self.assertEqual(kb['spec']['config']['server.basePath'],'/elk')
        self.assertTrue(kb['spec']['config']['server.rewriteBasePath'])
        es=next(x for x in docs if x['kind']=='Elasticsearch')
        self.assertEqual(es['spec']['volumeClaimDeletePolicy'],'DeleteOnScaledownOnly')
        for role in (x for x in docs if x['kind']=='Role'):
            self.assertEqual(role['rules'][0]['resources'],['pods'])
            self.assertEqual(role['rules'][0]['verbs'],['get','list','watch'])
        ds=next(x for x in docs if x['kind']=='DaemonSet')
        for mount in ds['spec']['template']['spec']['containers'][0]['volumeMounts']:
            if mount['name'] in ('containers','pods'):self.assertTrue(mount['readOnly'])
        pipeline=(BASE/'pipeline/pipeline.conf').read_text()
        self.assertIn('ssl_client_authentication => "required"',pipeline)
        self.assertIn('user => "elk_ingest"',pipeline)
        self.assertNotIn('user => "elastic"',pipeline)

    def test_collection_unique_bounded_and_multiline(self):
        fb=yaml.safe_load((BASE/'pipeline/filebeat.yml').read_text())
        inputs=fb['filebeat.inputs']
        self.assertEqual(len({x['id'] for x in inputs}),len(inputs))
        paths=[path for x in inputs for path in x['paths']]
        self.assertEqual(len(paths),len(set(paths)))
        self.assertTrue(all('/containers/' in path and '_els_' not in path for path in paths))
        for x in inputs:
            self.assertLessEqual(x['message_max_bytes'],65536)
            self.assertEqual(x['parsers'][0]['container']['format'],'auto')
            self.assertEqual(x['parsers'][1]['multiline']['max_lines'],100)
        self.assertEqual(fb['output.logstash']['ssl.verification_mode'],'full')

    def test_bootstrap_roles_retention_precision(self):
        spec=importlib.util.spec_from_file_location('elk_bootstrap',BASE/'pipeline/bootstrap.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        definitions=dict(module.definitions())
        role=definitions['/_security/role/elk_ingest']
        self.assertEqual(role['cluster'],['monitor'])
        self.assertEqual(role['indices'][0]['privileges'],['create_doc'])
        for name,days in [('roboshop-logs','7d'),('roboshop-malformed','1d')]:
            self.assertEqual(definitions['/_ilm/policy/'+name]['policy']['phases']['delete']['min_age'],days)
            t=definitions['/_index_template/'+name]['template']
            self.assertEqual(t['settings']['number_of_replicas'],0)
            self.assertEqual(t['settings']['number_of_shards'],1)
            self.assertFalse(t['mappings']['dynamic'])
            self.assertEqual(t['mappings']['properties']['@timestamp']['type'],'date_nanos')
        self.assertIn('SSSSSSSSS',definitions['/_ingest/pipeline/roboshop-timestamps']['processors'][0]['date']['output_format'])

    def test_actual_ruby_filter(self):
        if not shutil.which('ruby'):self.skipTest('Ruby unavailable; Logstash parser not executed')
        # Event shim models get/set/remove only. The production filter is loaded unchanged.
        harness=r'''
require 'json'
class Event
  def initialize(data); @data=data; end
  def parts(key); key.start_with?('[') ? key.scan(/\[([^\]]+)\]/).flatten : [key]; end
  def get(key); parts(key).reduce(@data) { |v,k| v.is_a?(Hash) ? v[k] : nil }; end
  def set(key,value)
    keys=parts(key); tail=keys.pop; hash=@data
    keys.each { |k| hash[k] ||= {}; hash=hash[k] }; hash[tail]=value
  end
  def remove(key); @data.delete(key); end
  def to_hash; @data; end
end
load ARGV[0]
JSON.parse(STDIN.read).each { |input| puts JSON.generate(filter(Event.new(input)).map(&:to_hash)) }
'''
        secret='DO_NOT_STORE@example.com'
        records=[
          {'timestamp':'2026-10-26T01:02:03.123456789Z','event':'request_completed','level':'INFO','traceId':'a'*32,'spanId':'b'*16,'durationMs':12.25,'status':429,'method':'POST','password':secret,'headers':{'Authorization':secret},'prompt':secret,'message':secret},
          {'time':'2026-10-26T01:02:03Z','level':'ERROR','trace_id':'c'*32,'span_id':'d'*16,'durationMs':5,'errorCode':'RESET_EMAIL_DELIVERY_FAILED','email':secret},
          {'duration':0.125,'status':500},
          {'Duration':1234567,'DownstreamStatus':503,'RequestMethod':'GET'},
          '{bad json '+secret,
          '2026-10-26T01:02:03.123Z ERROR worker java.lang.IllegalStateException: '+secret+'\n\tat com.example.run(File.java:1)',
          {'traceId':['invalid'],'spanId':{'id':secret},'durationMs':{'bad':1},'level':secret},
          [],
        ]
        fixtures=[{'@timestamp':'2026-10-26T00:00:00Z','message':r if isinstance(r,str) else json.dumps(r),'kubernetes':{'namespace':'roboshop-ai','container':{'name':'nginx' if i==2 else 'test-service'}}} for i,r in enumerate(records)]
        fixtures.append({'message':'ignore','kubernetes':{'namespace':'els'}})
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'harness.rb';path.write_text(harness)
            out=subprocess.check_output(['ruby',str(path),str(BASE/'pipeline/normalize.rb')],input=json.dumps(fixtures),text=True)
        self.assertNotIn(secret,out)
        results=[json.loads(line) for line in out.splitlines()]
        first=results[0][0]
        self.assertEqual(first['trace']['id'],'a'*32)
        self.assertEqual(first['span']['id'],'b'*16)
        self.assertEqual(first['event']['duration'],12250000)
        self.assertEqual(first['event']['created'],'2026-10-26T01:02:03.123456789Z')
        self.assertEqual(first['http']['response']['status_code'],429)
        self.assertEqual(results[1][0]['diagnostic']['errorCode'],'RESET_EMAIL_DELIVERY_FAILED')
        self.assertEqual(results[2][0]['event']['duration'],125000000)
        self.assertEqual(results[3][0]['event']['duration'],1234567)
        self.assertEqual(results[4][0]['@metadata']['target'],'roboshop-malformed')
        self.assertEqual(results[5][0]['diagnostic']['errorType'],'java.lang.IllegalStateException')
        self.assertNotIn('trace',results[6][0])
        self.assertEqual(results[7][0]['@metadata']['target'],'roboshop-malformed')
        self.assertEqual(results[8],[])

    def test_saved_objects_and_preview(self):
        objects=[json.loads(x) for x in (BASE/'dashboards/roboshop.ndjson').read_text().splitlines()]
        ids={(x['type'],x['id']) for x in objects}
        for obj in objects:
            for ref in obj.get('references',[]):self.assertIn((ref['type'],ref['id']),ids)
        self.assertEqual(sum(x['type']=='search' for x in objects),6)
        for action in ('credentials','dashboards'):
            result=subprocess.run(['python3',str(ROOT/'scripts/observability/elk.py'),action],cwd='/tmp',capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('Preview only',result.stdout)


if __name__=='__main__':unittest.main()

class ElkOwnershipTests(unittest.TestCase):
    def test_optional_applications_have_unique_ownership_and_safe_defaults(self):
        docs=render('core')+render('pipeline')
        seen=set()
        external_secrets={'els-credentials','logs-es-http-certs-public','logs-es-elastic-user'}
        generated={x['spec']['secretName'] for x in docs if x['kind']=='Certificate'}
        configmaps={x['metadata']['name'] for x in docs if x['kind']=='ConfigMap'}
        for obj in docs:
            key=(obj['apiVersion'],obj['kind'],obj['metadata'].get('namespace',''),obj['metadata']['name'])
            self.assertNotIn(key,seen);seen.add(key)
            if obj['kind'] in ('Deployment','DaemonSet','Job'):
                spec=obj['spec']['template']['spec']
                for volume in spec.get('volumes',[]):
                    if 'secret' in volume:self.assertIn(volume['secret']['secretName'],external_secrets|generated)
                    if 'configMap' in volume:self.assertIn(volume['configMap']['name'],configmaps)
                for container in spec['containers']:
                    self.assertIn(':',container['image']);self.assertNotIn(':latest',container['image'])
                    self.assertIn('requests',container['resources']);self.assertIn('limits',container['resources'])
                    self.assertFalse(container.get('securityContext',{}).get('privileged',False))
        for name in ('elk-core','elk-pipeline','elk-operator'):
            app=yaml.safe_load((ROOT/'argocd'/f'{name}.yaml').read_text())
            self.assertNotIn('automated',app['spec']['syncPolicy'])
            self.assertNotIn('finalizers',app['metadata'])
            self.assertIn('FailOnSharedResource=true',app['spec']['syncPolicy']['syncOptions'])
        active=yaml.safe_load((ROOT/'argocd/kustomization.yaml').read_text())['resources']
        self.assertNotIn('elk-operator.yaml',active)
