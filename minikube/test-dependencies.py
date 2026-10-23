"""Deployment dependency checks must never download or repair host tools."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
SCRIPT=Path(__file__).with_name('install-dependencies.sh').resolve()
class DependenciesTests(unittest.TestCase):
 def run_case(self,broken=False):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   for name,body in {'helm':'exit 1' if broken else 'echo v3.19.0','kubectl':'exit 0','curl':'echo unexpected-download >&2; exit 99'}.items():
    p=root/name;p.write_text('#!/bin/sh\n'+body+'\n');p.chmod(0o755)
   return subprocess.run(['bash',str(SCRIPT)],env={**os.environ,'PATH':str(root)+':'+os.environ['PATH']},capture_output=True,text=True)
 def test_reuse(self):self.assertEqual(self.run_case().returncode,0)
 def test_broken_tool_requires_explicit_setup(self):self.assertNotEqual(self.run_case(True).returncode,0)

if __name__=='__main__':unittest.main()
