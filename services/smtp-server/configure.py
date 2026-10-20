#!/usr/bin/env python3
"""Create SMTP secrets once, preserve existing keys, and print only public DNS data."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True)
    args = parser.parse_args()
    command = ['kubectl', '--context', args.context, '-n', 'robotshop-ai']

    def get(name):
        result = subprocess.run(command + ['get', 'secret', name, '--ignore-not-found', '-o', 'json'], check=True, capture_output=True, text=True)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def create(name, values):
        body = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': 'robotshop-ai'}, 'type': 'Opaque', 'stringData': values}
        subprocess.run(command + ['create', '-f', '-'], input=json.dumps(body), text=True, check=True, stdout=subprocess.DEVNULL)

    dkim = get('smtp-dkim')
    with tempfile.TemporaryDirectory(prefix='robotshop-mail-') as directory:
        private = Path(directory) / 'key.pem'
        if dkim:
            private.write_bytes(base64.b64decode(dkim['data']['robotshop.private']))
            private.chmod(0o600)
        else:
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(private)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            private.chmod(0o600)
            create('smtp-dkim', {'robotshop.private': private.read_text()})
        public = subprocess.run(['openssl', 'pkey', '-in', str(private), '-pubout', '-outform', 'DER'], check=True, capture_output=True).stdout
    auth = get('robotshop-auth')
    values = {
        'SMTP_HOST': 'smtp-server.robotshop-ai.svc.cluster.local', 'SMTP_PORT': '587',
        'SMTP_FROM': 'no-reply@jithendar.com', 'SMTP_SECURITY': 'starttls',
        'SMTP_USERNAME': '', 'SMTP_PASSWORD': '',
        'SMTP_CA_FILE': '/etc/robotshop-smtp/ca.crt',
        'SMTP_CLIENT_CERT': '/etc/robotshop-smtp/tls.crt',
        'SMTP_CLIENT_KEY': '/etc/robotshop-smtp/tls.key',
    }
    if not auth or 'AUTH_ENCRYPTION_KEY' not in auth.get('data', {}):
        values['AUTH_ENCRYPTION_KEY'] = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
    if auth:
        # Only update SMTP settings. Never rotate an enrolled user's encryption key.
        body = {'stringData': values}
        subprocess.run(command + ['patch', 'secret', 'robotshop-auth', '--type=merge', '--patch-file=/dev/stdin'], input=json.dumps(body), text=True, check=True, stdout=subprocess.DEVNULL)
    else:
        create('robotshop-auth', values)
    print('Secrets configured; existing DKIM and authenticator encryption keys preserved.')
    print('Publish TXT robotshop._domainkey.jithendar.com:')
    print('v=DKIM1; k=rsa; p=' + base64.b64encode(public).decode())


if __name__ == '__main__':
    os.umask(0o077)
    main()
