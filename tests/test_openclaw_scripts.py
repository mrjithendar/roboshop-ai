import importlib.util
from pathlib import Path
from unittest.mock import patch
import pytest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('openclaw_manage',ROOT/'scripts/openclaw/manage.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def test_context_is_never_changed():
 with patch.dict('os.environ',{'OPENCLAW_CONTEXT':'expected'}),patch.object(m,'require'),patch.object(m,'run',return_value='different\n') as run:
  with pytest.raises(RuntimeError,match='Context mismatch'):m.context()
  assert run.call_args[0][0]==['kubectl','config','current-context']
def test_context_must_be_explicit():
 with patch.dict('os.environ',{},clear=True),patch.object(m,'require'):
  with pytest.raises(RuntimeError,match='Set OPENCLAW_CONTEXT'):m.context()
def test_noninteractive_changes_fail_closed():
 with patch.object(m,'context',return_value='mk4'),patch.object(m.sys.stdin,'isatty',return_value=False):
  with pytest.raises(RuntimeError,match='interactive'):m.confirm('deploy')
def test_restore_never_overwrites(tmp_path):
 from argparse import Namespace
 with patch.object(m,'require'):
  with pytest.raises(RuntimeError,match='must not exist'):m.restore(Namespace(archive='backup.age',identity='key',target=str(tmp_path)))
def test_backup_never_overwrites(tmp_path):
 from argparse import Namespace
 target=tmp_path/'backup.age';target.write_text('keep')
 with patch.object(m,'require'),patch.object(m,'context',return_value='mk4'):
  with pytest.raises(RuntimeError,match='already exists'):m.backup(Namespace(output=str(target),recipient='recipient'))
 assert target.read_text()=='keep'

@pytest.mark.parametrize('blockers,blocked', [
 (['NetworkPolicy enforcement requires recorded evidence'],False),
 (['NetworkPolicy enforcement requires recorded evidence','Certificate not Ready'],True),
 (['kindest/kindnetd does not implement NetworkPolicy'],True),
])
def test_network_evidence_only_clears_evidence_blocker(tmp_path,blockers,blocked):
 import datetime,json
 evidence=tmp_path/'evidence.json'
 evidence.write_text(json.dumps(dict(context='mk4',allowedConnection=True,deniedConnection=True,recoveredConnection=True,checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())))
 with patch.dict('os.environ',{'OPENCLAW_NETWORK_EVIDENCE':str(evidence)}),patch.object(m,'doctor',return_value=blockers),patch.object(m,'context',return_value='mk4'),patch.object(m,'run',return_value=''),patch.object(m,'kube') as kube:
  if blocked:
   with pytest.raises(RuntimeError):m.deployment_gate()
   kube.assert_not_called()
  else:
   m.deployment_gate()
   assert kube.call_count==3

def test_missing_evidence_preserves_network_blocker(tmp_path):
 with patch.dict('os.environ',{'OPENCLAW_NETWORK_EVIDENCE':str(tmp_path/'missing.json')}),patch.object(m,'doctor',return_value=['kindest/kindnetd does not implement NetworkPolicy']),patch.object(m,'run',return_value=''),patch.object(m,'kube') as kube:
  with pytest.raises(RuntimeError) as error:m.deployment_gate()
  assert 'kindest/kindnetd' in str(error.value)
  assert 'actual output path' in str(error.value)
  kube.assert_not_called()

def test_status_before_bootstrap(capsys):
 with patch.object(m.sys,'argv',['manage.py','status']),patch.object(m,'kube',return_value=''):
  assert m.main()==0
 assert 'bootstrap has not completed' in capsys.readouterr().out

@pytest.fixture
def network():
 import sys
 spec=importlib.util.spec_from_file_location('openclaw_network',ROOT/'scripts/openclaw/network_smoke.py')
 module=importlib.util.module_from_spec(spec)
 with patch.dict(sys.modules,{'manage':m}):spec.loader.exec_module(module)
 return module

@pytest.mark.parametrize('connected',[True,False])
def test_network_probe_requires_remote_result(network,connected):
 import json,subprocess
 result=subprocess.CompletedProcess([],0,json.dumps({'openclawConnected':connected}),'')
 with patch.object(network.subprocess,'run',return_value=result):
  assert network.probe('mk4','test','10.0.0.1') is connected

@pytest.mark.parametrize('failure',['timeout','exec_error','invalid_output'])
def test_network_transport_failure_is_not_denial(network,failure):
 import subprocess
 result=subprocess.CompletedProcess([],1,'','exec failed') if failure=='exec_error' else subprocess.CompletedProcess([],0,'not-json','')
 with patch.object(network.subprocess,'run',side_effect=subprocess.TimeoutExpired('kubectl',30) if failure=='timeout' else None,return_value=result) as run,patch.object(network.time,'sleep'):
  with pytest.raises(RuntimeError,match='inconclusive'):network.probe('mk4','test','10.0.0.1')
  assert run.call_count==3

def test_network_transient_timeout_recovers(network):
 import subprocess
 with patch.object(network.subprocess,'run',side_effect=[subprocess.TimeoutExpired('kubectl',30),subprocess.CompletedProcess([],0,'{"openclawConnected":true}','')]),patch.object(network.time,'sleep'):
  assert network.probe('mk4','test','10.0.0.1') is True

@pytest.mark.parametrize('results,error',[
 ([True,False,False,False,True],None),
 ([False]*10,'Positive control'),
 ([False,False,True,False,False,False,True],None),
 ([True]+[True]*10,'denial was not verified'),
 ([True,False,False,False]+[False]*10,'Recovery control'),
])
def test_network_controls(network,results,error):
 from unittest.mock import Mock
 with patch.object(network.time,'sleep'):
  if error:
   with pytest.raises(RuntimeError,match=error):network.controls(Mock(side_effect=results),Mock(),Mock())
  else:network.controls(Mock(side_effect=results),Mock(),Mock())

def test_network_failure_cleans_up_without_evidence(network,tmp_path):
 import subprocess
 output=tmp_path/'nested'/'evidence.json'
 with patch.object(network.sys,'argv',['network_smoke.py','--output',str(output)]),patch.object(network,'context',return_value='mk4'),patch.object(network,'confirm'),patch.object(network,'controls',side_effect=RuntimeError('inconclusive')),patch.object(network.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'10.0.0.1','')) as run:
  with pytest.raises(RuntimeError,match='inconclusive'):network.main()
  assert not output.exists()
  assert 'delete' in run.call_args.args[0] and 'namespace' in run.call_args.args[0]


def test_positive_control_failure_never_applies_deny(network):
 from unittest.mock import Mock
 apply=Mock()
 with patch.object(network.time,'sleep'):
  with pytest.raises(RuntimeError,match='before any deny policy'):
   network.controls(lambda:False,apply,Mock())
 apply.assert_not_called()

def test_network_server_waits_for_listener(network,tmp_path):
 import json,subprocess
 output=tmp_path/'evidence.json'
 with patch.object(network.sys,'argv',['network_smoke.py','--output',str(output)]),patch.object(network,'context',return_value='mk4'),patch.object(network,'confirm'),patch.object(network,'controls'),patch.object(network.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'10.0.0.1','')) as run:
  assert network.main()==0
 manifests=[json.loads(call.kwargs['input']) for call in run.call_args_list if 'input' in call.kwargs]
 server=next(obj for obj in manifests if obj['metadata']['name']=='server')
 container=server['spec']['containers'][0]
 assert container['readinessProbe']['tcpSocket']['port']==8080
 assert container['command'][-2:]==['--bind','0.0.0.0']


@pytest.mark.parametrize('changes',[
 {'context':'other'}, {'allowedConnection':False}, {'deniedConnection':False},
 {'recoveredConnection':False}, {'checkedAt':'2020-01-01T00:00:00+00:00'},
])
def test_invalid_network_evidence_cannot_clear_gate(tmp_path,changes):
 import datetime,json
 evidence=tmp_path/'evidence.json'
 data=dict(context='mk4',allowedConnection=True,deniedConnection=True,recoveredConnection=True,checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 data.update(changes);evidence.write_text(json.dumps(data))
 with patch.dict('os.environ',{'OPENCLAW_NETWORK_EVIDENCE':str(evidence)}),patch.object(m,'doctor',return_value=['NetworkPolicy enforcement requires evidence']),patch.object(m,'context',return_value='mk4'),patch.object(m,'run',return_value=''),patch.object(m,'kube') as kube:
  with pytest.raises(RuntimeError,match='NetworkPolicy enforcement requires'):m.deployment_gate()
  kube.assert_not_called()

def test_kindnet_detection_uses_evidence_gate():
 resources={
 'namespaces':{'items':[]},
 'daemonsets':{'items':[{'spec':{'template':{'spec':{'containers':[{'image':'kindest/kindnetd:test'}]}}}}]},
 'certificates.cert-manager.io':{'items':[{'metadata':{'name':'jithendar-com'},'status':{'conditions':[{'type':'Ready','status':'True'}]}}]},
 'tlsstores.traefik.io':{'items':[{'metadata':{'name':'default','namespace':'jithendar'},'spec':{'defaultCertificate':{'secretName':'jithendar-com-tls'}}}]}}
 with patch.object(m,'get',side_effect=lambda kind,*args:resources[kind]),patch.object(m,'context',return_value='mk4'),patch.object(m,'kube',return_value='standard'):
  issues=m.doctor()
 assert len(issues)==1
 assert issues[0].startswith('NetworkPolicy enforcement requires')


def test_initial_secrets_match_and_are_private(tmp_path):
 import json,stat
 spec=importlib.util.spec_from_file_location('prepare_secrets',ROOT/'scripts/openclaw/prepare_secrets.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 data=module.manifest('test-key')
 gateway,identities,metrics=[item['stringData'] for item in data['items']]
 tokens=json.loads(identities['identities.json'])
 for agent in module.AGENTS:assert gateway['OPS_'+agent.upper()+'_TOKEN']==tokens[agent]
 assert len(set(tokens.values()))==9
 assert all(len(token)>=32 for token in tokens.values())
 assert metrics['token']==tokens['monitor']
 assert metrics['gateway-token']==gateway['OPENCLAW_GATEWAY_TOKEN']
 output=tmp_path/'secrets.json';module.write_manifest(output,data)
 assert stat.S_IMODE(output.stat().st_mode)==0o600
 with pytest.raises(FileExistsError):module.write_manifest(output,data)

@pytest.fixture
def registry():
 import sys
 spec=importlib.util.spec_from_file_location('openclaw_registry',ROOT/'scripts/openclaw/refresh_registry.py')
 module=importlib.util.module_from_spec(spec)
 with patch.dict(sys.modules,{'manage':m}):spec.loader.exec_module(module)
 return module

@pytest.mark.parametrize('result', [
 {'failures':[{'failureCode':'ImageNotFound'}]},
 {'images':[]},
])
def test_registry_missing_image_preserves_secret(registry,result):
 import json
 with patch.object(registry.sys,'argv',['refresh_registry.py','--profile','pull']),patch.object(registry,'context',return_value='mk4'),patch.object(registry,'kube',return_value='namespace/openclaw'),patch.object(registry,'aws',side_effect=[json.dumps({'Arn':'arn:aws:iam::881026659929:root'}),json.dumps(result)]),patch.object(registry.subprocess,'run') as run:
  with pytest.raises(RuntimeError,match='preserved'):registry.main()
  run.assert_not_called()

def test_registry_denial_preserves_secret(registry):
 import json,subprocess
 with patch.object(registry.sys,'argv',['refresh_registry.py']),patch.object(registry,'context',return_value='mk4'),patch.object(registry,'kube',return_value='namespace/openclaw'),patch.object(registry,'aws',side_effect=[json.dumps({'Arn':'caller'}),subprocess.CalledProcessError(1,['aws'])]),patch.object(registry.subprocess,'run') as run:
  with pytest.raises(RuntimeError,match='preserved'):registry.main()
  run.assert_not_called()

def test_registry_profile_used_for_validation_and_token(registry,capsys):
 import json,base64
 with patch.object(registry.sys,'argv',['refresh_registry.py','--profile','pull']),patch.object(registry,'context',return_value='mk4'),patch.object(registry,'kube',return_value='namespace/openclaw'),patch.object(registry,'confirm'),patch.object(registry,'aws',side_effect=[json.dumps({'Arn':'caller'}),json.dumps({'images':[{'imageId':{}}]}),'test-password']) as aws,patch.object(registry.subprocess,'run') as run:
  assert registry.main()==0
  assert all(call.args[1]=='pull' for call in aws.call_args_list)
  secret=json.loads(run.call_args.kwargs['input'])
  config=json.loads(base64.b64decode(secret['data']['.dockerconfigjson']))
  assert base64.b64decode(config['auths'][registry.REGISTRY]['auth'])==b'AWS:test-password'
  assert 'test-password' not in capsys.readouterr().out


def test_plugin_copy_does_not_change_volume_root_metadata(tmp_path):
 import shutil,yaml
 source=tmp_path/'source';source.mkdir()
 (source/'plugin').mkdir();(source/'plugin'/'index.js').write_text('plugin')
 (source/'manifest.json').write_text('{}')
 target=tmp_path/'volume';target.mkdir()
 workloads=list(yaml.safe_load_all((ROOT/'minikube/openclaw/base/workloads.yaml').read_text()))
 deployment=next(x for x in workloads if x['kind']=='Deployment' and x['metadata']['name']=='openclaw')
 command=deployment['spec']['template']['spec']['initContainers'][0]['command'][2]
 command=command.replace('/opt/openclaw-plugins',str(source)).replace('/plugins',str(target))
 original=shutil.copystat
 def copystat(src,dst,**kwargs):
  if Path(dst)==target:raise PermissionError('volume root belongs to root')
  return original(src,dst,**kwargs)
 with patch.object(shutil,'copystat',side_effect=copystat):
  exec(command,{})
  exec(command,{})
 assert (target/'plugin'/'index.js').read_text()=='plugin'
 assert (target/'manifest.json').read_text()=='{}'
