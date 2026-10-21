"""Exercise tool installation with fake downloads and installers; no host changes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class ToolTests(unittest.TestCase):
    def test_architectures_and_repair(self):
        for arch, expected in [('x86_64','x86_64'),('aarch64','aarch64')]:
            with self.subTest(arch=arch), tempfile.TemporaryDirectory() as d:
                root=Path(d); bin=root/'bin'; bin.mkdir(); runner=root/'runner'; runner.mkdir()
                scripts={
                    'sed': 'exit 0',
                    'uname': f'if [ "$1" = -s ]; then echo Linux; else echo {arch}; fi',
                    'curl': '''echo "$*" >> "$CALLS"
while [ "$1" != -o ]; do shift; done
printf '#!/bin/sh\nexit 0\n' > "$2"''',
                    'unzip': '''while [ "$1" != -d ]; do shift; done
mkdir -p "$2/aws"
printf '#!/bin/sh\necho "aws-install $*" >> "$CALLS"\n' > "$2/aws/install"
chmod +x "$2/aws/install"''',
                }
                for name,body in scripts.items():
                    p=bin/name; p.write_text('#!/bin/sh\n'+body); p.chmod(0o755)
                tools=runner/'.tools'; (tools/'bin').mkdir(parents=True); (tools/'python/bin').mkdir(parents=True)
                for name in ['bin/uv','bin/aws','python/bin/python']:
                    p=tools/name; p.write_text('#!/bin/sh\necho "'+name+' $*" >> "$CALLS"\n'); p.chmod(0o755)
                # An existing but broken interpreter must be repaired.
                (tools/'python/bin/python').write_text('#!/bin/sh\n[ "$1" != "-c" ]\n')
                (tools/'aws-cli/v2').mkdir(parents=True)
                calls=root/'calls'
                env=dict(os.environ,HOME=str(root),PATH=str(bin)+':'+os.environ['PATH'],CALLS=str(calls))
                r=subprocess.run(['bash',str(Path(__file__).with_name('install-tools.sh')),str(runner)],env=env,text=True,capture_output=True)
                self.assertEqual(r.returncode,0,r.stderr)
                log=calls.read_text()
                self.assertIn(f'awscli-exe-linux-{expected}.zip',log)
                self.assertIn('python install 3',log)
                self.assertIn('--managed-python --python 3 --seed --clear',log)
                self.assertNotIn('--reinstall',log)
                self.assertIn('--update',log)
                self.assertTrue((runner/'.tools/env.sh').exists())
                self.assertIn('roboshop-runner-tools', (root/'.bashrc').read_text())

    def test_healthy_tools_are_reused_without_network(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            runner = root / 'runner'
            tools = runner / '.tools'
            bin = root / 'bin'
            bin.mkdir()
            scripts = {
                bin/'uname': 'echo Linux',
                bin/'sed': 'exit 0',
                bin/'curl': 'echo unexpected-download >&2; exit 99',
                tools/'bin/aws': 'echo aws-cli/2.38.3',
                tools/'python/bin/python': 'exit 0',
            }
            # uname -m must report a supported architecture.
            scripts[bin/'uname'] = 'if [ "$1" = -s ]; then echo Linux; else echo aarch64; fi'
            for path, body in scripts.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('#!/bin/sh\n' + body + '\n')
                path.chmod(0o755)
            env = dict(os.environ, HOME=str(root), PATH=str(bin)+':'+os.environ['PATH'])
            result = subprocess.run(['bash', str(Path(__file__).with_name('install-tools.sh')), str(runner)],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Reusing installed Python', result.stdout)
            self.assertIn('Reusing installed AWS CLI v2', result.stdout)
            self.assertNotIn('unexpected-download', result.stderr)

if __name__ == '__main__': unittest.main()
