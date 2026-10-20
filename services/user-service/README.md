# User service

Independent Python service on port **4109**, with its own Dockerfile, dependencies,
tests and Kubernetes manifest. Like legacy RobotShop's user component, it owns
MongoDB-backed registration, login and customer order history. It preserves the
modern app's role checks, password hashing, session cookies and account protections.
It does not import code from another service directory.

## Responsibilities

- Register, sign in and sign out; hashed, expiring MongoDB sessions.
- Customer/admin/single-superadmin roles and user administration.
- Microsoft Authenticator-compatible TOTP, encrypted seeds and one-use backup codes.
- Email password reset using five-minute OTPs, attempt limits and session revocation.
- Turnstile verification for registration, login and reset requests.
- Profile details/photos, addresses, login IP/browser metadata and purchase history.
- Paid-order projection and verified-purchase checks for reviews.

The gateway keeps the public URLs `/api/auth/*`, `/api/account/*` and
`/api/admin/users*`. The frontend, finder, cart and checkout continue using these
URLs. User-service resolves the account from the session itself; a caller cannot
supply a customer/admin identity in a browser request. It is ClusterIP-only and
requires `USER_SERVICE_TOKEN` on every internal API. Only health and readiness
checks are public within the cluster. Never publish the service directly through
an ingress or expose the service token to the browser.

The gateway retains its checkout ledger and a background retry loop. Paid orders
are sent through `/internal/purchase`; the service writes immutable history keyed
by order ID. Failed requests remain pending and are replayed. Review verification
uses `/internal/verified-purchase`; the gateway no longer queries user collections.

## Configuration

Required: `MONGODB_URL`, `USER_SERVICE_TOKEN` (at least 32 characters).
Optional `MONGODB_DATABASE` defaults to `robotshop`.
`PUBLIC_ORIGIN` must match the store origin. `SHIPPING_URL` validates new addresses.
The service owns `REGISTRATION_CHALLENGE_PROVIDER`, `TURNSTILE_*`,
`AUTH_ENCRYPTION_KEY`, `SMTP_*`, and `LOGIN_ACTIVITY_RETENTION_DAYS`.

Minikube moves the existing `robotshop-auth` environment values and
`smtp-client-tls` mount from the gateway to this service. The existing encryption
key is retained: do not rotate it when moving enrolled authenticator accounts.
The gateway sends its validated client IP to the authenticated internal API;
`TRUST_PROXY=false` prevents a second interpretation of browser forwarding headers.
OpenTelemetry uses the same `OTEL_*` settings as the other Python services.
`/health`, `/metrics`, and `/api/users/ready` support operations; readiness checks MongoDB.

## Upgrade an existing Minikube deployment

No data export or destructive migration is needed: the service uses the same
MongoDB database, collections, user IDs, password hashes and session schema.
Existing modern RobotShop accounts and sessions remain valid. This does not import
legacy upstream password formats into the modern account database.

On the Minikube host, from the repository root:

```bash
# SMTP already has an image if installed previously. Reapply its policy/cert settings.
bash minikube/deploy-smtp.sh
bash build-images.sh --service user-service --local
bash deploy-minikube.sh --service user-service --load-images
bash build-images.sh --service ai-gateway --local
bash deploy-minikube.sh --service ai-gateway --load-images
kubectl -n robotshop-ai get pods -l app=user-service
kubectl -n robotshop-ai logs deployment/user-service --tail=80
```

The deployment helper automatically adds a missing `USER_SERVICE_TOKEN` to
`robotshop-secrets`, preserving all existing keys and passwords. The full
**Deploy-Minikube** workflow deploys ECR images in SMTP → user-service → gateway order.
An existing frontend needs no rebuild for this extraction. If password-reset UI
has not been deployed previously, build/deploy frontend as described in the SMTP guide.

Before rerouting gateway traffic, verify user-service is Ready. To roll back,
redeploy the previous gateway image **and its previous manifest** so it regains
its old account credentials, and restore the prior SMTP NetworkPolicy if email
recovery must run from that gateway. Never erase MongoDB or regenerate the MFA key.

## CI and ECR

`ci-user-service.yml` runs the user tests, then invokes `publish-ecr.yml` to build
and publish `robotshop-user-service` with a unique SHA tag. Terraform includes the
repository in `ecr_repository_names`. Apply the infrastructure plan before the
first ECR publish. Minikube uses `robotshop-user-service:local`.

## Local development and tests

```bash
cd services/user-service
python -m pip install -r requirements.txt -r tests/requirements.txt
python -m unittest discover -s tests -v
docker build -t robotshop-user-service:local .
```

The root `npm run dev` starts user-service and passes an ephemeral shared service
token to the gateway/user processes if none is configured. Supply MongoDB and SMTP
configuration separately. The superadmin setup command now runs
`services/user-service/bootstrap.py`; `npm run admin:bootstrap` points there.
It still accepts `SUPERADMIN_EMAIL`, `SUPERADMIN_NAME`, and `SUPERADMIN_PASSWORD`
from the environment and refuses to create a second superadmin. Keep passwords
out of shell history and source control.
