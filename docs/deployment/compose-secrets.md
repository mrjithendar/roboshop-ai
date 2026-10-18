# Compose secrets setup

Compose interpolation happens before containers start. Missing `.env` values
therefore prevent both `up` and `ps`. Run commands from the repository root.
Common service URLs and telemetry settings are defined once in
`services/common/compose.yml` and inherited using `extends`.
RabbitMQ's username defaults to `robotshop`; database URLs are assembled by
Compose. Only seven generated secrets are needed: separate Mongo root/app,
Postgres owner/app, Redis, RabbitMQ passwords, and the internal payment token.
Separate credentials retain the existing database privilege boundaries.

For a fresh installation:

```bash
python3 generate-secrets.py
docker compose config --quiet
docker compose up -d
docker compose ps
```

The generator uses Python's cryptographic RNG for independent 256-bit secrets
(64 URL-safe hex characters), writes mode 0600, never prints values and refuses
to overwrite any existing file. `.env` is gitignored. Optional AI and Razorpay
credentials must come from those providers; they cannot be randomly generated.
Set `PUBLIC_ORIGIN` to the actual shop URL; live payments require HTTPS.
Image availability/ECR authentication must also be configured separately.

If `.env` already exists, retain it and its credentials. Generate a separate file
with `python3 generate-secrets.py --output .env.generated` and copy only missing
values after checking whether the databases/broker were previously initialized.
Changing bootstrap variables does not change passwords in existing volumes.
Recover the original credentials or explicitly rotate them in the services;
do not delete volumes to fix missing configuration.

## Store the same credentials in AWS Secrets Manager

After generating `.env`, this command uploads its generated credential keys as
one JSON secret. It preserves the exact credentials used by Compose. Requires
AWS CLI credentials (prefer an EC2 IAM role), `secretsmanager:CreateSecret`, and
an available secret name. Change the region/name for your environment.

```bash
(
  set -euo pipefail
  umask 077
  secret_file=$(mktemp)
  trap 'rm -f "$secret_file"' EXIT
  python3 - "$secret_file" <<'PY'
import json
import sys
from pathlib import Path
import runpy
keys = (*runpy.run_path('generate-secrets.py')['PASSWORD_KEYS'], 'RABBITMQ_USERNAME')
values = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines()
              if line and not line.startswith('#') and '=' in line)
selected = {key: values.get(key, 'robotshop' if key == 'RABBITMQ_USERNAME' else '') for key in keys}
if not all(selected.values()):
    raise SystemExit('Required values are missing in .env')
Path(sys.argv[1]).write_text(json.dumps(selected))
PY
  aws secretsmanager create-secret \
    --region ap-south-1 \
    --name robotshop/production \
    --secret-string "file://$secret_file" \
    --query ARN --output text
)
```

This uploader expects the unquoted KEY=value format produced by the generator.
It does not overwrite an existing AWS secret. Compose reads the local `.env`;
storing a secret in AWS does not automatically inject it into Compose. Grant a
replacement EC2 instance `secretsmanager:GetSecretValue` on this secret to retrieve
and securely materialize the same values before starting containers.

For JSON-only provisioning, use `python3 generate-secrets.py --format json
--output .env.secrets.json` (on one line). Do not generate another independent
credential set for an already initialized installation.

[AWS create-secret reference](https://docs.aws.amazon.com/cli/latest/reference/secretsmanager/create-secret.html)
