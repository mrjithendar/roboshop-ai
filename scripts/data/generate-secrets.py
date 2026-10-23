#!/usr/bin/env python3
# Generate credentials locally without contacting AWS or Kubernetes. Exclusive
# file creation avoids rotating passwords accidentally on an existing install;
# the output has mode 0600 and only its path is printed.

"""Generate a new private native-development env file or AWS Secrets Manager JSON payload."""

# CentOS-only operator command; imports remain usable by isolated tests.
if __name__ == '__main__':
    import sys as _host_sys
    if not any(arg in ('--help', '-h') for arg in _host_sys.argv[1:]):
        import subprocess as _host_subprocess
        from pathlib import Path as _HostPath
        _host_gate = _HostPath(__file__).resolve().parent / '../..' / 'scripts/lib/require-centos.sh'
        if _host_subprocess.call(['bash', str(_host_gate)]):
            raise SystemExit(1)

import argparse
import json
import os
from pathlib import Path
import secrets

PASSWORD_KEYS = (
    'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD',
    'SHIPPING_DB_PASSWORD', 'SHIPPING_APP_PASSWORD',
    'USER_SERVICE_TOKEN', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD', 'PAYMENT_SERVICE_TOKEN', 'LLM_SERVICE_TOKEN',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--format', choices=('env', 'json'), default='env')
    parser.add_argument('--output', default=str(Path(__file__).resolve().parents[2]/'.env'), help='New file only; existing files are never overwritten')
    args = parser.parse_args()
    values = {key: secrets.token_hex(32) for key in PASSWORD_KEYS}
    values['RABBITMQ_USERNAME'] = 'roboshop'
    content = (json.dumps(values, indent=2) + '\n' if args.format == 'json'
               else '# Generated credentials: keep private; do not commit.\n' +
               ''.join(f'{key}={value}\n' for key, value in values.items()))
    try:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error(f'{args.output} already exists; preserve existing database credentials or choose another --output')
    with os.fdopen(fd, 'w') as output:
        output.write(content)
    print(f'Created {Path(args.output)} with mode 0600. Secret values were not printed.')


if __name__ == '__main__':
    main()
