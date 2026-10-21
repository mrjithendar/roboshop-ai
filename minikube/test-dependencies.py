"""Offline dependency reuse/repair checks, with downloads and installers mocked."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('install-dependencies.sh').resolve()

class DependenciesTests(unittest.TestCase):
    def run_case(self, broken=False, download_fail=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tools = root / 'tools'
            tools.mkdir()
            def executable(name, body):
                path = tools / name
                path.write_text('#!/bin/bash\n' + body)
                path.chmod(0o755)
            executable('helm', 'exit 1' if broken else 'echo v3.19.0')
            executable('kubectl', 'exit 0')
            executable('curl', 'exit 22' if download_fail else """echo download >> "$CALLS"
while [[ "$1" != -o ]]; do shift; done
cat > "$2" <<'INSTALL'
#!/bin/bash
printf '#!/bin/bash\necho v3.19.0\n' > "$HELM_INSTALL_DIR/helm"
chmod +x "$HELM_INSTALL_DIR/helm"
INSTALL
""")
            # Keep host detection, health checks and installer logic; isolate destinations.
            code = SCRIPT.read_text()
            code = code[:code.index('# Root repairs')]
            code += '\ninstall_deployment_dependencies\n'
            env = dict(os.environ, DEPLOY_TOOL_BIN=str(tools),
                       PATH=str(tools)+':'+os.environ['PATH'], CALLS=str(root/'calls'))
            result = subprocess.run(['bash', '-c', code], env=env, text=True, capture_output=True)
            return result, (root/'calls').exists(), len(list(tools.glob('helm-backup.*/helm')))

    def test_healthy_tools_skip_downloads(self):
        result, downloaded, backups = self.run_case()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(downloaded)
        self.assertEqual(backups, 0)

    def test_broken_helm_backed_up_and_replaced(self):
        result, downloaded, backups = self.run_case(broken=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(downloaded)
        self.assertEqual(backups, 1)

    def test_failed_download_stops(self):
        result, _, backups = self.run_case(broken=True, download_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(backups, 1)

if __name__ == '__main__':
    unittest.main()
