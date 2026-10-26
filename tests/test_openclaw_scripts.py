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
