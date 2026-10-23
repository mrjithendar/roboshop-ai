#!/usr/bin/env python3
"""Expose the verified private CLI at the command path used by root's shell."""

# CentOS-only operator command; imports remain usable by isolated tests.
if __name__ == '__main__':
    import sys as _host_sys
    if not any(arg in ('--help', '-h') for arg in _host_sys.argv[1:]):
        import subprocess as _host_subprocess
        from pathlib import Path as _HostPath
        _host_gate = _HostPath(__file__).resolve().parent / '..' / 'scripts/lib/require-centos.sh'
        if _host_subprocess.call(['bash', str(_host_gate)]):
            raise SystemExit(1)

import os
from pathlib import Path
import subprocess
import sys
import tempfile


def publish(source, destination):
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    result = subprocess.run([str(source), '--version'], check=True, capture_output=True, text=True)
    if not (result.stdout + result.stderr).strip().startswith('aws-cli/2.'):
        raise ValueError('Refusing to publish a command that is not AWS CLI v2.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() and destination.resolve() == source:
        return
    if destination.is_dir() and not destination.is_symlink():
        raise ValueError('Refusing to replace a directory with the AWS command.')
    # Back up the previous command before an atomic replacement, including symlinks.
    if os.path.lexists(destination):
        import shutil
        backup_dir = Path(tempfile.mkdtemp(prefix='aws-command-backup-', dir=destination.parent))
        shutil.copy2(destination, backup_dir / 'aws', follow_symlinks=False)
        print(f'Previous AWS command preserved at {backup_dir / "aws"}')
    temporary = Path(tempfile.mkdtemp(prefix='.aws-command-', dir=destination.parent))
    try:
        link = temporary / 'aws'
        link.symlink_to(source)
        os.replace(link, destination)
    finally:
        temporary.rmdir()
    print(f'Official AWS CLI v2 available at {destination}')


if __name__ == '__main__':
    publish(*sys.argv[1:])
