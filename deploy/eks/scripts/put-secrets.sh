#!/usr/bin/env bash
# D. Generates random application credentials locally and stores them in Secrets Manager
# (the container created by terraform/secrets.tf). Nothing is printed or written to disk.
# Re-running REPLACES the values: only do that before data stores are initialised, or rotate
# each credential deliberately (passwords are baked into MongoDB/PostgreSQL/RabbitMQ volumes).
#   deploy/eks/scripts/put-secrets.sh deploy/eks/env/<cluster>.env [--force]
. "$(dirname "$0")/lib.sh" "$1"
need aws jq openssl
secret_id="$SECRETS_PREFIX/$ENVIRONMENT/app"

if aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$secret_id" >/dev/null 2>&1 \
   && [ "${2:-}" != "--force" ]; then
  echo "$secret_id already has a value; pass --force to replace it (see header)." >&2; exit 1
fi

# The super admin is required (user-service has no default administrator). Prompt silently.
if [ -z "${SUPERADMIN_EMAIL:-}" ]; then read -r -p "Super admin email: " SUPERADMIN_EMAIL; fi
if [ -z "${SUPERADMIN_PASSWORD:-}" ]; then read -r -s -p "Super admin password (not echoed): " SUPERADMIN_PASSWORD; echo; fi
[ -n "$SUPERADMIN_EMAIL" ] && [ ${#SUPERADMIN_PASSWORD} -ge 12 ] || { echo "Super admin email and a 12+ character password are required." >&2; exit 1; }

rand() { openssl rand -hex 24; }
# Optional third-party credentials come from the environment, never from arguments.
jq -n \
  --arg mongo_root "$(rand)" --arg mongo_app "$(rand)" --arg redis "$(rand)" \
  --arg rabbit "$(rand)" --arg keda "$(rand)" --arg ship_db "$(rand)" --arg ship_app "$(rand)" \
  --arg llm "$(rand)" --arg pay "$(rand)" --arg user "$(rand)" --arg authkey "$(openssl rand -base64 32)" \
  --arg admin_email "${SUPERADMIN_EMAIL:-}" --arg admin_pw "${SUPERADMIN_PASSWORD:-}" \
  --arg rzp_id "${RAZORPAY_TEST_KEY_ID:-}" --arg rzp_secret "${RAZORPAY_TEST_KEY_SECRET:-}" \
  --arg rzp_hook "${RAZORPAY_TEST_WEBHOOK_SECRET:-}" \
  --arg ts_site "${TURNSTILE_SITE_KEY:-}" --arg ts_secret "${TURNSTILE_SECRET_KEY:-}" \
  '{MONGO_ROOT_PASSWORD:$mongo_root, MONGO_APP_PASSWORD:$mongo_app, REDIS_PASSWORD:$redis,
    RABBITMQ_PASSWORD:$rabbit, RABBITMQ_KEDA_PASSWORD:$keda,
    SHIPPING_DB_PASSWORD:$ship_db, SHIPPING_APP_PASSWORD:$ship_app,
    LLM_SERVICE_TOKEN:$llm, PAYMENT_SERVICE_TOKEN:$pay, USER_SERVICE_TOKEN:$user,
    AUTH_ENCRYPTION_KEY:$authkey, SUPERADMIN_EMAIL:$admin_email, SUPERADMIN_PASSWORD:$admin_pw,
    RAZORPAY_TEST_KEY_ID:$rzp_id, RAZORPAY_TEST_KEY_SECRET:$rzp_secret,
    RAZORPAY_TEST_WEBHOOK_SECRET:$rzp_hook,
    TURNSTILE_SITE_KEY:$ts_site, TURNSTILE_SECRET_KEY:$ts_secret}
   | with_entries(select(.value != ""))' \
| aws secretsmanager put-secret-value --region "$AWS_REGION" --secret-id "$secret_id" \
    --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
echo "Stored $secret_id (values not shown). Razorpay and Turnstile keys are optional:"
echo "payments stay unavailable and registration challenges disabled until you add them."
