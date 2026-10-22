import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ParallelTests(unittest.TestCase):
    def test_install_and_rerun_preserve_active_slots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copy(Path(__file__).with_name('setup-parallel.sh'), root)
            (root / 'systemctl').write_text('#!/bin/sh\nexit 0\n')
            (root / 'systemctl').chmod(0o700)
            (root / 'setup.sh').write_text('''#!/bin/bash
set -eu
mkdir -p "$RUNNER_DIR"
printf '{"gitHubUrl":"https://github.com/%s"}' "$1" > "$RUNNER_DIR/.runner"
echo service > "$RUNNER_DIR/.service"
echo "$RUNNER_NAME" >> "$CALL_LOG"
''')
            env = {**os.environ, 'RUNNER_DIR': str(root / 'runner'), 'RUNNER_NAME': 'host', 'CALL_LOG': str(root / 'calls'), 'PATH': str(root)+os.pathsep+os.environ['PATH']}
            for _ in range(2):
                result = subprocess.run(['bash', str(root / 'setup-parallel.sh')], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / 'calls').read_text().splitlines(), ['host'] + [f'host-{slot}' for slot in range(2, 11)])
            (root / 'runner/.runner').write_text(json.dumps({'gitHubUrl':'https://github.com/other/repo'}))
            result = subprocess.run(['bash', str(root / 'setup-parallel.sh')], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('another repository', result.stderr)

    def test_invalid_count_rejected_before_setup(self):
        for count in ('0', '21', 'five', '-1'):
            result = subprocess.run(['bash', str(Path(__file__).with_name('setup-parallel.sh'))], env={**os.environ, 'RUNNER_COUNT':count}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('RUNNER_COUNT', result.stderr)

    def test_pending_registration_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copy(Path(__file__).with_name('setup-parallel.sh'), root)
            (root/'setup.sh').write_text('exit 0\n')
            result = subprocess.run(['bash', str(root/'setup-parallel.sh')], env={**os.environ, 'RUNNER_DIR':str(root/'runner')}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not active', result.stderr)
