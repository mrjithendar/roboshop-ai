"""Mocked installation checks; never modify a Kubernetes cluster."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from installer_test_helpers import prepare_source

SCRIPT = Path(__file__).with_name('deploy-cert-manager.sh').resolve()

class CertManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bindir = self.root / '.local/bin'
        bindir.mkdir(parents=True)
        for name in ('helm', 'kubectl'):
            p = bindir / name
            p.write_text('#!/bin/sh\necho "'+name+' $*" >> "$TEST_LOG"\n'
                         'case "$*" in *"get namespace kube-system"*) exit "${PREFLIGHT_EXIT:-0}";; esac\n')
            p.chmod(0o755)
        state = self.root / '.minikube/roboshop-installer'
        state.mkdir(parents=True)
        (state/'mk4.profile').write_text('mk4-selected\n')
        self.env = {k:v for k,v in os.environ.items() if k not in ('KUBE_CONTEXT','PROFILE','MINIKUBE_HOME','LETSENCRYPT_EMAIL','INGRESS_CLASS','CERT_MANAGER_VERSION')}
        self.env.update(HOME=str(self.root),TEST_LOG=str(self.root/'calls'))
        # Prevent real /usr/local/bin installations from taking precedence.
        self.script = self.root/'deploy.sh'
        source = SCRIPT.read_text().replace('/usr/local/bin:$HOME/.local/bin:$PATH', '$HOME/.local/bin:$PATH')
        self.script.write_text(prepare_source(source))

    def run_script(self, **env):
        return subprocess.run(['bash',str(self.script)],env={**self.env,**env},capture_output=True,text=True)

    def test_selected_profile_and_install_order(self):
        result=self.run_script()
        self.assertEqual(result.returncode,0,result.stderr)
        calls=(self.root/'calls').read_text()
        self.assertIn('--kube-context=mk4-selected upgrade --install cert-manager',calls)
        self.assertLess(calls.index('upgrade --install cert-manager'),calls.index('upgrade --install roboshop-letsencrypt'))
        self.assertIn('clusterissuer/letsencrypt-staging clusterissuer/letsencrypt-prod',calls)

    def test_explicit_context_and_class(self):
        result=self.run_script(KUBE_CONTEXT='remote',INGRESS_CLASS='nginx',LETSENCRYPT_EMAIL='operator@example.com')
        self.assertEqual(result.returncode,0,result.stderr)
        calls=(self.root/'calls').read_text()
        self.assertIn('--kube-context=remote',calls)
        self.assertIn('ingressClassName=nginx',calls)
        self.assertIn('email=operator@example.com',calls)

    def test_preflight_failure_does_not_install(self):
        self.assertNotEqual(self.run_script(PREFLIGHT_EXIT='1').returncode,0)
        self.assertNotIn('helm ',(self.root/'calls').read_text())

if __name__=='__main__':
    unittest.main()
