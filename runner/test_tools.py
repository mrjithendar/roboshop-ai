"""Exercise tool installation with fake downloads and installers; no host changes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class ToolTests(unittest.TestCase):
    def test_architectures_and_update(self):
        for arch, expected in [('x86_64','x86_64'),('aarch64','aarch64')]:
            with self.subTest(arch=arch), tempfile.TemporaryDirectory() as d:
                root=Path(d); bin=root/'bin'; bin.mkdir(); runner=root/'runner'; runner.mkdir()
                scripts={
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
                (tools/'aws-cli/v2').mkdir(parents=True)
                calls=root/'calls'
                env=dict(os.environ,PATH=str(bin)+':'+os.environ['PATH'],CALLS=str(calls))
                r=subprocess.run(['bash',str(Path(__file__).with_name('install-tools.sh')),str(runner)],env=env,text=True,capture_output=True)
                self.assertEqual(r.returncode,0,r.stderr)
                log=calls.read_text()
                self.assertIn(f'awscli-exe-linux-{expected}.zip',log)
                self.assertIn('python install 3 --reinstall',log)
                self.assertIn('--managed-python --python 3 --seed --clear',log)
                self.assertIn('-m pip install --upgrade pip',log)
                self.assertIn('--update',log)
                self.assertTrue((runner/'.tools').exists())

if __name__ == '__main__': unittest.main()
