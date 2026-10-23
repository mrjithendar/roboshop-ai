> Deployment update: orchestration now uses [Minikube](../../minikube/roboshop/README.md); older deployment descriptions below are historical. Use root `build-images.sh` and `scripts/deploy/deploy-minikube.sh`.

# Customer records in MongoDB

The Python `user-service` owns customer records and authentication, following the
legacy RoboShop user-service boundary. The gateway forwards public account APIs
and checks sessions through authenticated internal HTTP calls.
Authenticated registration/login records the server-derived IP address, sanitized
browser user-agent (up to 512 characters), UTC timestamp and login count. The
`users` document also receives `lastLoginAt` and `updatedAt`. Registration activity
counts as the first authenticated login. Failed password attempts do not populate
customer login history; the existing authentication limiter still applies.

| Collection | Purpose |
| --- | --- |
| `customer_profiles` | One document per user: latest login, IP/browser, login count and registration metadata |
| `login_activity` | Recent successful logins; user/time index and TTL expiry |
| `customer_addresses` | Up to ten distinct recently used validated delivery addresses per user |
| `purchase_history` | Immutable paid-order snapshots keyed by order UUID, indexed by user/payment time |

`LOGIN_ACTIVITY_RETENTION_DAYS` defaults to 90 (1–3650 allowed). MongoDB TTL deletion
is asynchronous; the activity API explicitly excludes expired entries immediately.
Changing this value affects newly recorded events, not previously assigned expiry
dates. The latest profile metadata remains until replaced; addresses and purchase
records have no automatic TTL. Do not interpret this default as a legal retention
policy. The store operator owns retention, deletion, backup and access policy.

IP collection uses the socket address during direct development. Behind the
private gateway, `TRUST_PROXY=true` accepts a validated `X-Real-IP` overwritten by
NGINX. Do not expose the trusted-proxy gateway directly or configure NGINX to trust
arbitrary forwarding senders. This is an observed network address, not verified
location/device identity. No geolocation, advertising fingerprint or card data is
collected.

## Purchase durability

The existing JSON ledger remains the authoritative single-writer checkout ledger.
Each new order captures its account owner before payment. After verified capture,
a gateway background worker sends the paid snapshot to the user service, which
upserts it into MongoDB. Only after success does the gateway
marks the ledger record synchronized. Order IDs prevent duplicate history entries
on repeated webhooks, verification, restarts or retries. Shipping snapshots and item
prices come from the verified server-side order, never browser-submitted history.
A temporary user-service or MongoDB failure leaves the record pending for replay, without undoing
payment capture. Monetary summary totals use integer minor units. History usually
appears within a few seconds; prolonged errors emit `customer_history_sync_pending`.

Existing paid orders can be backfilled when their ledger session still identifies
a user. Anonymous historical orders with no recorded account ownership are never
assigned by guessing an email or address. Keep coordinated backups of MongoDB and
the JSON ledger. This is a history projection, not a migration of the transactional
ledger to MongoDB, and does not make the gateway horizontally scalable. Refunds and
returns need a separate verified lifecycle before history can represent those states.

## APIs and UI

Customers open their name in the storefront header to view account activity, saved
addresses and paginated purchases. Registration explains the captured metadata.
Super admins have an explicit **Customer details** action in the existing users
panel. Product admins cannot access another customer's private information.

- `GET /api/account/profile`: current account profile, addresses and purchase summary.
- `GET /api/account/activity`: latest 20 nonexpired login events.
- `GET /api/account/purchases?cursor=…`: 20 owned orders per page, with an opaque next cursor.
- `GET /api/admin/users/:id/profile`, `/activity`, `/purchases`: super-admin-only counterparts.

The account routes derive ownership exclusively from the server session; request
parameters cannot select another user. Responses are no-store, password/session
hashes and internal order keys are excluded, and UI values use `textContent`.
Customer data is excluded from OpenTelemetry spans, metrics and application logs.
MongoDB should use authenticated TLS connections and encrypted storage/backups in
production; the local Compose database is for development.
