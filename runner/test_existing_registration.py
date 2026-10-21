import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ExistingRegistrationTests(unittest.TestCase):
    def test_existing_registration_with_and_without_bom(self):
        setup = (Path(__file__).parent / 'setup.sh').read_text()
        check = setup.split("<<'PY'\n", 1)[1].split('\nPY', 1)[0]
        for encoding in ('utf-8', 'utf-8-sig'):
            with self.subTest(encoding=encoding), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / '.runner'
                state.write_text(json.dumps({'gitHubUrl': 'https://github.com/owner/repo'}), encoding=encoding)
                original = state.read_bytes()
                result = subprocess.run([sys.executable, '-c', check, 'owner/repo'], cwd=directory, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                mismatch = subprocess.run([sys.executable, '-c', check, 'other/repo'], cwd=directory, capture_output=True, text=True)
                self.assertNotEqual(mismatch.returncode, 0)
                self.assertIn('another repository', mismatch.stderr)
                self.assertEqual(state.read_bytes(), original)
