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
