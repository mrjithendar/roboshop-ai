"""Runner tools reuse initialized dependencies without host downloads/repair."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_helpers import runner_source
class ToolTests(unittest.TestCase):
 def test_reuses_private_tools_without_downloads_or_shell_edits(self):
  with tempfile.TemporaryDirectory(prefix='runner tools ') as temp:
   root=Path(temp);(root/'runner').mkdir();(root/'bin').mkdir();(root/'.venv/bin').mkdir(parents=True)
   script=root/'runner/install-tools.sh';script.write_text(runner_source(Path(__file__).with_name('install-tools.sh')))
   for path,body in [(root/'bin/aws','echo aws-cli/2.38.4'),(root/'.venv/bin/python','exit 99'),(root/'instance/.tools/python/bin/python','exit 0')]:
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o755)
   env={**os.environ,'HOME':str(root),'PATH':str(root/'bin')+':'+os.environ['PATH']}
   for _ in range(2):
    result=subprocess.run(['bash',str(script),str(root/'instance')],env=env,capture_output=True,text=True)
    self.assertEqual(result.returncode,0,result.stderr)
   self.assertFalse((root/'.bashrc').exists())
   self.assertTrue((root/'instance/.tools/bin/aws').is_symlink())
 def test_help_is_readonly(self):
  result=subprocess.run(['bash',str(Path(__file__).with_name('install-tools.sh')),'--help'],capture_output=True,text=True)
  self.assertEqual(result.returncode,0)
