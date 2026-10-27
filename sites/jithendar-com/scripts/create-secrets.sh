#!/usr/bin/env bash
# One-time creation of the jithendar.com Secrets in namespace jithendar (run by an admin, never by CI).
#   scripts/create-secrets.sh [kube-context]
# Generates every password/key randomly. Prompts only for Cloudflare Turnstile keys and optional SMTP.
# Refuses to overwrite existing Secrets: the Postgres password is baked into the database on first
# start, so changing it here would lock the site out.
set -euo pipefail

CONTEXT="${1:-mk4}"
NS="jithendar"
k() { kubectl --context "$CONTEXT" -n "$NS" "$@"; }
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"${1:-40}"; }

for s in jithendar-postgres jithendar-redis jithendar-com-env; do
  if k get secret "$s" >/dev/null 2>&1; then
    echo "Secret $s already exists. Nothing changed. (Delete it deliberately first if you really mean to recreate it.)" >&2
    exit 1
  fi
done

read -r -p "Cloudflare Turnstile site key: " TURNSTILE_SITE_KEY
read -r -s -p "Cloudflare Turnstile secret key: " TURNSTILE_SECRET_KEY; echo
[[ -n "$TURNSTILE_SITE_KEY" && -n "$TURNSTILE_SECRET_KEY" ]] || { echo "Turnstile keys are required (Cloudflare dashboard → Turnstile → add site jithendar.com)." >&2; exit 1; }
read -r -p "SMTP URL (optional, e.g. smtps://user:pass@smtp.example.com:465; Enter to skip): " SMTP_URL
MAIL_FROM=""
[[ -n "$SMTP_URL" ]] && read -r -p "Mail From (e.g. Jithendar.com <no-reply@jithendar.com>): " MAIL_FROM

PG_PASSWORD="$(rand 40)"
REDIS_PASSWORD="$(rand 40)"
BOOTSTRAP="$(rand 48)"

k create secret generic jithendar-postgres --from-literal=password="$PG_PASSWORD"
k create secret generic jithendar-redis --from-literal=password="$REDIS_PASSWORD"
args=(
  --from-literal=DATABASE_URL="postgres://jithendar:${PG_PASSWORD}@jithendar-postgres:5432/jithendar"
  --from-literal=REDIS_URL="redis://:${REDIS_PASSWORD}@jithendar-redis:6379"
  --from-literal=BETTER_AUTH_SECRET="$(rand 64)"
  --from-literal=SETTINGS_ENCRYPTION_KEY="$(rand 64)"
  --from-literal=ADMIN_BOOTSTRAP_TOKEN="$BOOTSTRAP"
  --from-literal=METRICS_TOKEN="$(rand 40)"
  --from-literal=TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY"
  --from-literal=TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY"
)
[[ -n "$SMTP_URL" ]] && args+=(--from-literal=SMTP_URL="$SMTP_URL" --from-literal=MAIL_FROM="$MAIL_FROM")
k create secret generic jithendar-com-env "${args[@]}"

cat <<MSG

Secrets created in namespace $NS: jithendar-postgres, jithendar-redis, jithendar-com-env.

One-time admin setup token (shown once; also stored in jithendar-com-env/ADMIN_BOOTSTRAP_TOKEN):

  $BOOTSTRAP

After deploying, open https://jithendar.com/setup and use it to create the first admin.
Back up SETTINGS_ENCRYPTION_KEY with your database backups: without it, stored S3/backup
credentials cannot be decrypted.
MSG
