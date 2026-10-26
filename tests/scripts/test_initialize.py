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
  for script,args in [('init.sh',['--help']),('scripts/images/build-push-ecr.sh',['--help']),('deploy-minikube.sh',['--help']),('delete_branch.sh',['--help'])]:
   r=subprocess.run(['bash',str(ROOT/script),*args],cwd='/tmp',capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr)
 def test_invalid_profile_before_commands(self):
  r=subprocess.run(['bash',str(ROOT/'init.sh'),'--profile','wrong'],cwd='/tmp',capture_output=True,text=True)
  self.assertEqual(r.returncode,2)

 def test_all_profiles_plan_with_missing_tools_offline(self):
  for distro,manager in [('centos','dnf'),('amzn','dnf'),('ubuntu','apt-get'),('macos','brew')]:
   for arch in ('amd64','arm64'):
    for profile in ('dev','docker','minikube','aws'):
     with self.subTest(distro=distro,arch=arch,profile=profile), tempfile.TemporaryDirectory() as temp:
      with patch.object(m,'host',return_value=(distro,'darwin' if distro=='macos' else 'linux',arch,manager)),patch.object(m,'ROOT',Path(temp)),patch.object(m.shutil,'which',return_value=None),patch.object(m,'run',side_effect=AssertionError('No mutations in plans')),patch.object(m.sys,'argv',['init','--profile',profile,'--dry-run']):
       self.assertEqual(m.main(),0)

 def test_other_platforms_rejected(self):
  for system,release in [('Windows',{}),('Linux',{'ID':'ubuntu','VERSION_ID':'20.04'}),('Linux',{'ID':'centos','VERSION_ID':'8','NAME':'CentOS Stream'}),('Linux',{'ID':'rocky','VERSION_ID':'9'})]:
   with self.subTest(system=system,release=release),self.assertRaises(ValueError):m.host(system,'x86_64',release)

 def test_shell_host_gate_with_fixture_releases(self):
  source=(ROOT/'scripts/lib/require-centos.sh').read_text()
  for release,expected in [('ID=centos\nVERSION_ID=9\nNAME="CentOS Stream"\n',0),('ID=centos\nVERSION_ID=10\nNAME="CentOS Stream"\n',0),('ID=ubuntu\nVERSION_ID=24.04\nNAME=Ubuntu\n',0),('ID=centos\nVERSION_ID=8\nNAME="CentOS Stream"\n',1)]:
   with tempfile.TemporaryDirectory(prefix='centos gate ') as temp:
    root=Path(temp);(root/'os-release').write_text(release)
    script=root/'gate.sh';script.write_text(source.replace('/etc/os-release',str(root/'os-release')).replace('. '+str(root/'os-release'),'. "'+str(root/'os-release')+'"').replace('-r '+str(root/'os-release'),'-r "'+str(root/'os-release')+'"'))
    uname=root/'uname';uname.write_text('#!/bin/sh\ncase "$1" in -s) echo Linux;; *) echo aarch64;; esac\n');uname.chmod(0o755)
    result=subprocess.run(['bash',str(script)],env={**os.environ,'PATH':str(root)+':'+os.environ['PATH']},capture_output=True,text=True)
    self.assertEqual(result.returncode,expected,result.stderr)

 def test_restored_platforms(self):
  for arch in ('x86_64','arm64'):
   self.assertEqual(m.host('Darwin',arch,{})[1],'darwin')
   for distro,v,manager in [('amzn','2023','dnf'),('ubuntu','22.04','apt-get'),('ubuntu','24.04','apt-get')]:
    self.assertEqual(m.host('Linux',arch,{'ID':distro,'VERSION_ID':v})[3],manager)

 def test_openssl_probe_reuse_and_install(self):
  result=subprocess.CompletedProcess([],0,stdout='OpenSSL 3.0.2 15 Mar 2022',stderr='')
  for existing in ('/usr/bin/openssl',None):
   i=m.Installer('install',('ubuntu','linux','amd64','apt-get'))
   installed=[]
   with patch.object(m.shutil,'which',return_value=existing),patch.object(m,'run',return_value=result) as run:
    i.need('openssl',lambda:installed.append(True))
    run.assert_called_once_with(['openssl','version'],True)
   self.assertEqual(bool(installed),existing is None)
  self.assertFalse(m.compatible('openssl','unrelated program'))
  self.assertFalse(m.compatible('openssl','OpenSSL 1.0.2'))

 def test_minikube_profile_reuses_working_openssl(self):
  outputs={'docker':'Docker version 29.0.0','openssl':'OpenSSL 3.0.2','kubectl':'{"clientVersion":{"gitVersion":"v1.37.0"}}','helm':'v3.19.0','minikube':'v1.39.0'}
  with patch.object(m,'host',return_value=('ubuntu','linux','amd64','apt-get')),patch.object(m.shutil,'which',return_value='/tools/tool'),patch.object(m,'version',side_effect=lambda t:outputs.get(t,'tool 1.0')),patch.object(m.sys,'argv',['init','--profile','minikube','--check']),patch.object(m,'run',side_effect=AssertionError('mutation')):
   self.assertEqual(m.main(),0)

 def test_package_manager_commands_are_mocked(self):
  for distro,manager in [('centos','dnf'),('amzn','dnf'),('ubuntu','apt-get'),('macos','brew')]:
   i=m.Installer('install',(distro,'darwin' if distro=='macos' else 'linux','arm64',manager))
   with patch.object(m.shutil,'which',return_value='/tool'),patch.object(m.os,'geteuid',return_value=1000),patch.object(m,'run') as run:
    i.packages(['jq'])
    expected=['brew','install','jq'] if manager=='brew' else ['sudo',manager,'install','-y','jq']
    self.assertEqual(run.call_args.args[0],expected)
    self.assertEqual(run.call_count,2 if manager=='apt-get' else 1)

 def test_mac_host_operations_rejected_and_portable_allowed(self):
  with tempfile.TemporaryDirectory() as temp:
   uname=Path(temp)/'uname';uname.write_text('#!/bin/sh\ncase "$1" in -s) echo Darwin;; *) echo arm64;; esac\n');uname.chmod(0o755)
   env={**os.environ,'PATH':temp+':'+os.environ['PATH']}
   for operation,status in [('portable',0),('linux',1),('centos',1)]:
    result=subprocess.run(['bash',str(ROOT/'scripts/lib/require-centos.sh'),'check',operation],env=env,capture_output=True)
    self.assertEqual(result.returncode,status)

 def test_all_profiles_check_missing_tools_without_installing(self):
  for profile in ('dev','docker','minikube','aws'):
   with tempfile.TemporaryDirectory() as temp,patch.object(m,'ROOT',Path(temp)),patch.object(m,'host',return_value=('ubuntu','linux','arm64','apt-get')),patch.object(m.shutil,'which',return_value=None),patch.object(m,'run',side_effect=AssertionError('check must not install')),patch.object(m.sys,'argv',['init','--profile',profile,'--check']):
    self.assertEqual(m.main(),1)
    self.assertEqual(list(Path(temp).iterdir()),[])

 def test_tool_specific_probe_arguments(self):
  probes={'openssl':['version'],'kubectl':['version','--client','-o','json'],'helm':['version','--short'],'java':['-version'],'minikube':['version','--short'],'terraform':['version','-json'],'aws':['--version'],'git':['--version'],'curl':['--version'],'jq':['--version'],'node':['--version'],'docker':['--version']}
  for tool,args in probes.items():
   with patch.object(m,'run',return_value=subprocess.CompletedProcess([],0,stdout='version',stderr='')) as run:
    m.version(tool)
    run.assert_called_once_with([tool,*args],True)
