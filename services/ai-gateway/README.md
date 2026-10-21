# AI gateway

Port 3000 serves the storefront, catalogue, recommendations, chat, cart and operations.
POST `/api/cart` accepts `{"sku":"RMC","quantity":2}` with absolute quantity (0 removes).
`/api/payments/config`, `/api/payments/orders`, `/api/payments/verify`,
`/api/payments/current`, `/api/payments/status?orderId=...` and `/api/payments/webhook`
implement Razorpay checkout. Order creation requires login and an Idempotency-Key header.
`POST /api/orders` returns 410; sandbox checkout uses the fully verified Razorpay
flow, not the removed fake-order endpoint. Default payment mode is test.

Prices and stock are server-authoritative. Pending payments reserve stock and lock cart
changes. Captured-payment processing is idempotent. Session ownership protects
payment status/verification. Webhooks authenticate raw bytes rather than browser origin.
Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS. Mutation origins are checked.
DATA_DIR defaults to `.data/`. Only one process may write this ledger.
See [payment-service](../payment-service/README.md) for activation and recovery boundaries.

MongoDB stores editable products and public store settings for this gateway.
The user service owns users and hashed sessions; `admin.py` enforces roles on
product and store-setting operations. Login is mandatory for payment browser APIs; signed
provider webhooks remain independent of browser sessions. See
[identity and admin](../../docs/architecture/identity-and-admin.md).


## Python runtime

`server.py` is the service entry point (Waitress, port 3000). Install this directory's
`requirements.txt` for native execution; `npm run dev` uses the `PYTHON` environment
variable or `python3`. The image contains Python gateway code and its local libraries only.

Delegated authentication, public settings, admin role checks, CSRF/origin checks, payment
verification and the single-writer JSON ledger preserve existing formats. A
reentrant lock serializes only local ledger validation and commits. Per-cart gates
serialize Redis synchronization and cart writes without blocking other customers;
a separate catalogue gate coordinates checkout reservations with gateway admin inventory edits.
The background Pika publisher uses durable quorum queues, mandatory routing and
publisher confirms before marking outbox entries delivered. Delivery is at least
once; the Java shipping consumer deduplicates event IDs and accepts only explicit
live merchant events. Test events route to `roboshop.test.orders`. Test reservations
and sales are separate from live stock. Orders and purchase history retain immutable
mode/demo provenance; test purchases never earn genuine verified-review badges.
See [sandbox setup and audited reconciliation](../../docs/deployment/razorpay-sandbox.md).

Additional endpoints are `/api/compare` (2–4 distinct SKUs) and authenticated
`/api/recommendations/personalized` (cart categories). MCP tools call these and the
same authenticated cart/admin endpoints; MCP never bypasses authorization.

Private customer profiles, successful login metadata, saved addresses and immutable
paid purchase history now live in MongoDB. The gateway retries pending history
projections from its ledger. See [customer records](../../docs/architecture/customer-records.md)
for access rules, retention, backfill behavior and the remaining single-writer limit.

## Independent service build

Run `docker build -t roboshop-ai-gateway:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).

## User-service integration

Authentication, MFA, password recovery, profiles, photos, addresses, account activity,
purchase history and admin user management are owned by
[`user-service`](../user-service/README.md). The public `/api/auth/*`, `/api/account/*`
and `/api/admin/users*` routes remain unchanged; `user_client.py` forwards them to
`USER_URL` (default `http://127.0.0.1:4109`) using `USER_SERVICE_TOKEN`.

Session checks fail closed if the service is unavailable. Anonymous catalogue
reads do not require a user-service session lookup. Login still links the gateway
cart to the authenticated account. `purchase_sync.py` retries paid-order projections
through the service API, marking the checkout ledger only after success. Review
purchase verification also calls the user service; the gateway no longer accesses
user/auth/profile/history collections or holds SMTP, MFA or Turnstile credentials.

Run cross-service HTTP contract tests from the repository root after installing
both service requirements and `mongomock`:
`python -m unittest discover -s services/ai-gateway/tests -v`.


## Checkout locking and recovery

The JSON ledger is **one process, one replica**, not a distributed order database.
Opening `DATA_DIR` acquires an exclusive OS `flock` on `writer.lock` for the lifetime
of the Store. A second process/Store fails startup. Do not unlink that lock file,
copy the ledger into another active replica, or use storage without reliable POSIX
locking. The Minikube Deployment uses `replicas: 1` and `strategy: Recreate`, so
upgrades briefly interrupt the gateway rather than overlap writers. A transactional
database/outbox is required before scaling. Back up the persistent ledger volume.

Lock order is catalogue gate (when needed), per-cart gate, then ledger lock.
No provider, catalogue, Redis, MongoDB, RabbitMQ or user-service network call runs
under the ledger lock. Local JSON copying, atomic file replacement, file fsync and
directory fsync still run under it: large ledgers or slow disks can delay requests.
Cart methods that perform I/O acquire their own gates; callers must not wrap them
in `store.lock`. Pure ledger reads/transitions use that lock explicitly.

| State | Durable meaning | Next transition |
| --- | --- | --- |
| `creating` | UUID/receipt, idempotency key, owner, cart/Redis revision, items, delivery quote, total/currency and payment mode/key ID are saved; stock is reserved. One request owns the create call. | Matching provider response → `payment_pending`; failure/timeout → `payment_review`. |
| `payment_review` | Creation outcome is unknown; the reservation remains. Startup moves interrupted `creating` orders here. | Read-only receipt lookup attaches exactly one matching provider order → `payment_pending`. No match, duplicates, account mismatch or lookup failure keep the reservation for later/manual reconciliation. |
| `payment_pending` | Provider order ID is attached to the frozen snapshot. | Server-verified capture → `paid`. Browser closure, provider errors and unsuccessful payment attempts leave this state unchanged. |
| `paid` | Capture identity is validated; sold inventory, cart clearing and a durable event ID are committed once. | Retry-safe Redis clearing, order-event delivery and user purchase-history projection. |

Each local transition increments the order revision. Network responses carry the
expected revision into a locked compare-and-apply step. Identical late replies and
capture retries return the existing result; mismatched identity, amount, currency,
account or state cannot replace it. A pending order is reused even if the browser
submits another idempotency key; a previously completed key returns its original
paid order. New checkout requires an unchanged cart revision after preparation.
Cart and delivery-address changes are rejected for all reserved states.

`GET /api/payments/current` or `/api/payments/status?orderId=...` reconciles an
ambiguous order by its UUID receipt, then verifies capture. Retrying checkout also
uses this recovery path, **never another provider create**. A verified webhook can
recover an orphan provider order through a server-side order lookup before capture
verification. A crash just before the provider call intentionally leaves an order
for review too: absence from a lookup cannot prove that a delayed create will not
complete. Do not delete reservations or edit statuses to force a retry.

Receipt lookup uses Razorpay's documented [order receipt filter](https://github.com/razorpay/razorpay-node/blob/master/documents/order.md).
No automatic cancellation, reservation expiry or refund/release flow is implemented.
Changes to payment mode/account block resumption until the original configuration
is restored. Use the merchant dashboard for unresolved or multiple-match cases.

Outbox delivery remains at least once with stable event IDs and publisher confirms.
A lost confirmation leaves delivery pending. Purchase-history projection retries
the same order ID; its completion marker is written only after the user service
acknowledges it. Redis clearing is also idempotent by paid-order ID and occurs before
accepting a new cart write, so retrying an old capture cannot erase a later cart.


## Liveness, readiness and optional features

`/health` checks this process only. Unauthenticated `/api/ready` bypasses session
lookup and probes only MongoDB, catalogue readiness, user-service readiness, the
local ledger writer and cart readiness (when Redis cart service is configured).
It returns 200 or 503 with named dependency states, within a 1.5-second response
budget and bounded probe concurrency. It never calls SRE, AI/model, Finder,
recommendations, payment, shipping or telemetry for storefront readiness.

`/api/ops` is the separate SRE aggregate dependency report. Optional feature calls
return HTTP 503 with `code: feature-unavailable` and a feature name on failure;
catalogue/cart routes remain independently usable. Direct-provider LLM saves and disconnect only validate
and persist settings. Enabling automatic Ollama-to-Bedrock failover requires both
providers to pass connection tests before the revision-checked commit. The private
`GET /internal/llm/config` endpoint requires service authorization and lets the agent
reject stale or disconnected configurations before each generation attempt. See
[health contracts](../../docs/architecture/health-checks.md).

## Transactional commerce migration

`COMMERCE_BACKEND=postgres` selects the transactional ledger in `postgres_store.py`;
set `COMMERCE_DATABASE_URL` and retain the authenticated Redis cart configuration.
Schema/import are explicit operator operations. There is no dual-write or fallback
on database failure. JSON remains the deployment default until an offline reviewed
cutover; its one-writer requirement still applies. PostgreSQL supports concurrent
gateway replicas with database reservations, idempotency and leased outbox workers.
See the [migration, state machine, inventory and rollback guide](../../docs/deployment/postgres-commerce-migration.md).
