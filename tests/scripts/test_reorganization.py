"""Offline contract checks, including source accidentally excluded by ignore rules."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
MAPPING=json.loads((ROOT/'scripts/path-mapping.json').read_text())

class ReorganizationTests(unittest.TestCase):
 def test_tracked_export_complete_and_ecr_preview_offline(self):
  tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
  for old,new in MAPPING.items():
   self.assertIn(old,tracked)
   self.assertIn(new,tracked,f'{new} is missing from Git; check ignore rules')
   self.assertTrue((ROOT/new).is_file())
  with tempfile.TemporaryDirectory(prefix='clean checkout with spaces ') as temp:
   export=Path(temp)/'repo';export.mkdir()
   for name in tracked:
    if not name or not (ROOT/name).is_file():continue
    target=export/name;target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/name,target)
   tools=Path(temp)/'tools';tools.mkdir()
   # Any AWS or Docker invocation, including read calls, fails the preview test.
   marker=Path(temp)/'external-call'
   for name in ('aws','docker'):
    path=tools/name;path.write_text(f'#!/bin/sh\ntouch "{marker}"\nexit 97\n');path.chmod(0o755)
   env={**os.environ,'PATH':str(tools)+':'+os.environ['PATH'],'AWS_ACCOUNT_ID':'123456789012','AWS_REGION':'us-east-1'}
   for script in ('build-push-ecr.sh',MAPPING['build-push-ecr.sh']):
    for args in (['--help'],['--dry-run','frontend','shipping-service']):
     result=subprocess.run(['bash',str(export/script),*args],cwd=temp,env=env,capture_output=True,text=True)
     self.assertEqual(result.returncode,0,result.stderr)
     if args[0]=='--dry-run':
      self.assertIn('123456789012.dkr.ecr.us-east-1.amazonaws.com',result.stdout)
      self.assertIn('roboshop-shipping',result.stdout)
      self.assertIn(':local',result.stdout)
   self.assertFalse(marker.exists())
   result=subprocess.run(['bash',str(export/'build-push-ecr.sh'),'--dry-run','unknown'],cwd=temp,env=env,capture_output=True)
   self.assertNotEqual(result.returncode,0)
   self.assertFalse(marker.exists())
  ignored=subprocess.run(['git','check-ignore','services/example/build/output.jar'],cwd=ROOT,capture_output=True)
  self.assertEqual(ignored.returncode,0)

 def test_all_wrappers_forward_arguments_and_exit_codes(self):
  for old,new in MAPPING.items():
   with self.subTest(wrapper=old),tempfile.TemporaryDirectory(prefix='wrapper spaces ') as temp:
    root=Path(temp);source=root/old;source.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/old,source)
    target=root/new;target.parent.mkdir(parents=True,exist_ok=True)
    if old.endswith('.sh'):
     target.write_text('#!/bin/bash\nprintf "%s\\n" "$@"\nexit 23\n');cmd=['bash']
    elif old.endswith('.py'):
     target.write_text('import sys\nprint("\\n".join(sys.argv[1:]))\nsys.exit(23)\n');cmd=['python3']
    else:
     if not shutil.which('node'):self.skipTest('Node unavailable for Node wrappers')
     target.write_text('console.log(process.argv.slice(2).join("\\n"));process.exit(23);\n');cmd=['node']
    result=subprocess.run(cmd+[str(source),'with spaces','--flag=value'],cwd='/tmp',capture_output=True,text=True)
    self.assertEqual(result.returncode,23,result.stderr)
    self.assertEqual(result.stdout.strip(),'with spaces\n--flag=value')
