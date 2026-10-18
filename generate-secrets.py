#!/usr/bin/env python3
"""Generate a new private Compose env file or AWS Secrets Manager JSON payload."""
import argparse
import json
import os
from pathlib import Path
import secrets

PASSWORD_KEYS = (
    'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD',
    'SHIPPING_DB_PASSWORD', 'SHIPPING_APP_PASSWORD',
    'REDIS_PASSWORD', 'RABBITMQ_PASSWORD', 'PAYMENT_SERVICE_TOKEN', 'LLM_SERVICE_TOKEN',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--format', choices=('env', 'json'), default='env')
    parser.add_argument('--output', default='.env', help='New file only; existing files are never overwritten')
    args = parser.parse_args()
    values = {key: secrets.token_hex(32) for key in PASSWORD_KEYS}
    values['RABBITMQ_USERNAME'] = 'robotshop'
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
