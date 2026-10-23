import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('initialize',ROOT/'scripts/setup/initialize.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class InitializeTests(unittest.TestCase):
 def test_platform_matrix(self):
  for arch in ('x86_64','aarch64'):
   for release in ({'ID':'centos','VERSION_ID':'9','NAME':'CentOS Stream'}, {'ID':'centos','VERSION_ID':'10','NAME':'CentOS Stream'}):
    self.assertIn(m.host('Linux',arch,release)[3],('dnf',))
  with self.assertRaises(ValueError):m.host('Linux','x86_64',{'ID':'debian','VERSION_ID':'12'})
  with self.assertRaises(ValueError):m.host('Linux','sparc',{})
 def test_readonly_and_reuse(self):
  for mode in ('check','dry-run'):
   i=m.Installer(mode,('centos','linux','arm64','dnf'))
   with patch.object(m,'run',side_effect=AssertionError('mutation')):
    i.packages(['jq'])
  i=m.Installer('install',('centos','linux','amd64','dnf'))
  with patch.object(m.shutil,'which',return_value='/bin/node'),patch.object(m,'version',return_value='v26.12.1'):
   for _ in range(2):i.need('node',lambda:self.fail('reinstalled'))
 def test_incompatible_install_not_replaced(self):
  i=m.Installer('install',('centos','linux','amd64','dnf'))
  with patch.object(m.shutil,'which',return_value='/bin/aws'),patch.object(m,'version',return_value='aws-cli/1.0'):
   with self.assertRaisesRegex(ValueError,'will not replace'):i.need('aws',lambda:self.fail('replaced'))
 def test_checksum_failure_never_publishes(self):
  i=m.Installer('install',('centos','linux','arm64','dnf'))
  def fetch(url,path):path.write_text('wrong')
  with tempfile.TemporaryDirectory() as temp,patch.object(m,'BIN',Path(temp)/'bin'),patch.object(i,'fetch',fetch):
   with self.assertRaisesRegex(ValueError,'checksum'):i.artifact('helm','https://example/file','https://example/sum')
   self.assertFalse((Path(temp)/'bin').exists())
 def test_help_and_dry_run_from_other_directory(self):
  for script,args in [('init.sh',['--help']),('scripts/build/build-push-ecr.sh',['--help']),('scripts/deploy/deploy-minikube.sh',['--help']),('delete_branch.sh',['--help'])]:
   r=subprocess.run(['bash',str(ROOT/script),*args],cwd='/tmp',capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr)
 def test_invalid_profile_before_commands(self):
  r=subprocess.run(['bash',str(ROOT/'init.sh'),'--profile','wrong'],cwd='/tmp',capture_output=True,text=True)
  self.assertEqual(r.returncode,2)

 def test_all_profiles_plan_with_missing_tools_offline(self):
  for distro,manager in [('centos','dnf')]:
   for arch in ('amd64','arm64'):
    for profile in ('dev','docker','minikube','aws'):
     with self.subTest(distro=distro,arch=arch,profile=profile), tempfile.TemporaryDirectory() as temp:
      with patch.object(m,'host',return_value=(distro,'linux',arch,manager)),patch.object(m,'ROOT',Path(temp)),patch.object(m.shutil,'which',return_value=None),patch.object(m,'run',side_effect=AssertionError('No mutations in plans')),patch.object(m.sys,'argv',['init','--profile',profile,'--dry-run']):
       self.assertEqual(m.main(),0)

 def test_other_platforms_rejected(self):
  for system,release in [('Darwin',{}),('Windows',{}),('Linux',{'ID':'amzn','VERSION_ID':'2023'}),('Linux',{'ID':'ubuntu','VERSION_ID':'24.04'}),('Linux',{'ID':'centos','VERSION_ID':'8','NAME':'CentOS Stream'}),('Linux',{'ID':'rocky','VERSION_ID':'9'})]:
   with self.subTest(system=system,release=release),self.assertRaises(ValueError):m.host(system,'x86_64',release)

 def test_shell_host_gate_with_fixture_releases(self):
  source=(ROOT/'scripts/lib/require-centos.sh').read_text()
  for release,expected in [('ID=centos\nVERSION_ID=9\nNAME="CentOS Stream"\n',0),('ID=centos\nVERSION_ID=10\nNAME="CentOS Stream"\n',0),('ID=ubuntu\nVERSION_ID=24.04\nNAME=Ubuntu\n',1),('ID=centos\nVERSION_ID=8\nNAME="CentOS Stream"\n',1)]:
   with tempfile.TemporaryDirectory(prefix='centos gate ') as temp:
    root=Path(temp);(root/'os-release').write_text(release)
    script=root/'gate.sh';script.write_text(source.replace('/etc/os-release',str(root/'os-release')).replace('. '+str(root/'os-release'),'. "'+str(root/'os-release')+'"').replace('-r '+str(root/'os-release'),'-r "'+str(root/'os-release')+'"'))
    uname=root/'uname';uname.write_text('#!/bin/sh\ncase "$1" in -s) echo Linux;; *) echo aarch64;; esac\n');uname.chmod(0o755)
    result=subprocess.run(['bash',str(script)],env={**os.environ,'PATH':str(root)+':'+os.environ['PATH']},capture_output=True,text=True)
    self.assertEqual(result.returncode,expected,result.stderr)
