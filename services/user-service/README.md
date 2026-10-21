# User service

Independent Python service on port **4109**, with its own Dockerfile, dependencies,
tests and Kubernetes manifest. Like legacy RoboShop's user component, it owns
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
Optional `MONGODB_DATABASE` defaults to `roboshop`.
`PUBLIC_ORIGIN` must match the store origin. `SHIPPING_URL` validates new addresses.
The service owns `REGISTRATION_CHALLENGE_PROVIDER`, `TURNSTILE_*`,
`AUTH_ENCRYPTION_KEY`, `SMTP_*`, and `LOGIN_ACTIVITY_RETENTION_DAYS`.

Minikube sends password-reset mail directly through SES at
`email-smtp.us-east-1.amazonaws.com:587` using STARTTLS and the public CA trust store.
Set `SMTP_USERNAME` and `SMTP_PASSWORD` in `roboshop-secrets` to SES SMTP credentials.
This single application Secret also holds `AUTH_ENCRYPTION_KEY` and database/service
credentials. Keep existing values during upgrades; do not regenerate the MFA key.
ECR pull credentials and cert-manager TLS Secrets remain separate Kubernetes types.
The manifest no longer reads the old private-CA/client-certificate settings.
Retain `AUTH_ENCRYPTION_KEY` so existing MFA enrolments remain valid.
Verify the SES domain/DNS and obtain production access for ordinary recipients.
See [SES setup](../../infrastructure/README.md#amazon-ses-transactional-email).

The gateway sends its validated client IP to the authenticated internal API;
`TRUST_PROXY=false` prevents a second interpretation of browser forwarding headers.
OpenTelemetry uses the same `OTEL_*` settings as the other Python services.
`/health`, `/metrics`, and `/api/users/ready` support operations; readiness checks MongoDB.

## Upgrade an existing Minikube deployment

No data export or destructive migration is needed: the service uses the same
MongoDB database, collections, user IDs, password hashes and session schema.
Existing modern RoboShop accounts and sessions remain valid. This does not import
legacy upstream password formats into the modern account database.

Run the user-service CI workflow, then **Deploy-Minikube**. The deployment uses
SES directly and removes the retired SMTP Deployment, Service and NetworkPolicy
after user-service is ready. It preserves the old SMTP queue PVC, certificates,
and keys. ECR repository deletion is controlled separately by Terraform. No live
cluster resources are changed by editing these files.
Existing database credentials and MFA encryption keys must remain unchanged.

## CI and ECR

`ci-user-service.yml` runs the user tests, then invokes `publish-ecr.yml` to build
and publish `roboshop-user-service` with the `latest` tag. Terraform includes the
repository in `ecr_repository_names`. Apply the infrastructure plan before the
first ECR publish. Minikube uses the ECR `roboshop-user-service:latest` image.

## Local development and tests

```bash
cd services/user-service
python -m pip install -r requirements.txt -r tests/requirements.txt
python -m unittest discover -s tests -v
docker build -t roboshop-user-service:local .
```

The root `npm run dev` starts user-service and passes an ephemeral shared service
token to the gateway/user processes if none is configured. Supply MongoDB and SMTP
configuration separately. The superadmin setup command now runs
`services/user-service/bootstrap.py`; `npm run admin:bootstrap` points there.
It still accepts `SUPERADMIN_EMAIL`, `SUPERADMIN_NAME`, and `SUPERADMIN_PASSWORD`
from the environment and refuses to create a second superadmin. Keep passwords
out of shell history and source control.
