"""Run the workflow's embedded detection code with mocked AWS/network calls."""
import io
import json
import os
from pathlib import Path
import tempfile
import textwrap
import unittest
from unittest.mock import patch

WORKFLOW = Path(__file__).resolve().parents[2] / '.github/workflows/create-infrastructure.yml'
CODE = textwrap.dedent(WORKFLOW.read_text().split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0])

class DetectionTests(unittest.TestCase):
    def detect(self, arn, ip='8.8.8.8', role=None):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'vars.json'
            responses = [json.dumps({'Arn': arn, 'Account': '123456789012'}).encode()]
            if role:
                responses.append(json.dumps({'Role': {'Arn': role}}).encode())
            with patch.dict(os.environ, EKS_VARS=str(output)), patch('subprocess.check_output', side_effect=responses), patch('urllib.request.urlopen', return_value=io.BytesIO(ip.encode())):
                exec(CODE, {})
            return json.loads(output.read_text())

    def test_user(self):
        arn = 'arn:aws:iam::123456789012:user/ci'
        result = self.detect(arn)
        self.assertEqual(result['eks_admin_principal_arns'], [arn])
        self.assertEqual(result['eks_public_access_cidrs'], ['8.8.8.8/32'])
        self.assertEqual(result['eks_private_access_cidrs'], [])

    def test_role_path(self):
        arn = 'arn:aws:iam::123456789012:role/team/ci'
        result = self.detect('arn:aws:sts::123456789012:assumed-role/ci/session', role=arn)
        self.assertEqual(result['eks_admin_principal_arns'], [arn])

    def test_root_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'IAM role or user'):
            self.detect('arn:aws:iam::123456789012:root')

    def test_nonpublic_ip_rejected(self):
        for ip in ['127.0.0.1', '10.0.0.1', '::1']:
            with self.subTest(ip=ip), self.assertRaises(SystemExit):
                self.detect('arn:aws:iam::123456789012:user/ci', ip)

if __name__ == '__main__':
    unittest.main()
