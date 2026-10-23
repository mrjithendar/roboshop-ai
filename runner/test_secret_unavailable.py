import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_helpers import python_runner_source

class SecretUnavailableTests(unittest.TestCase):
    def test_retrieval_failure_is_safe_and_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            aws=Path(tmp)/'aws'
            aws.write_text('#!/bin/sh\necho private-error-detail >&2\nexit 1\n')
            aws.chmod(0o755)
            r=subprocess.run(['python3','-c', python_runner_source(Path(__file__).with_name('register.py')), 'owner/repo','runner'],env=dict(os.environ,PATH=tmp+':'+os.environ['PATH'],RUNNER_AUTH='aws'),capture_output=True,text=True)
            self.assertEqual(r.returncode,75)
            self.assertIn('Registration is pending',r.stderr)
            self.assertNotIn('private-error-detail',r.stderr+r.stdout)

    def test_known_aws_errors_report_action_without_raw_details(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('runner_register_diagnostics', Path(__file__).with_name('register.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for code, expected in [('AccessDeniedException', 'Access denied'), ('ResourceNotFoundException', 'Secret not found'), ('ExpiredTokenException', 'expired'), ('UnrecognizedClientException', 'invalid')]:
            result = module.aws_retrieval_reason(f'An error occurred ({code}) private-secret-value')
            self.assertIn(expected, result)
            self.assertNotIn('private-secret-value', result)

    def test_setup_defers_only_retrieval_status(self):
        source=Path(__file__).with_name('setup.sh').read_text()
        block=source[source.index('  if python3 "$script_dir/register.py"'):source.index('\nelse\n  python3 - "$repo"')]
        for status,expected in [(75,0),(1,1),(0,0)]:
            with self.subTest(status=status):
                script=f'python3() {{ return {status}; }}\nrepo=test; script_dir=test; runner_dir=test\n'+block
                r=subprocess.run(['bash','-c',script],capture_output=True,text=True)
                self.assertEqual(r.returncode,expected)
                self.assertEqual('registration is pending' in r.stdout,status==75)

if __name__ == '__main__': unittest.main()
