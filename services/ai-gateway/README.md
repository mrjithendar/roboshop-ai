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

`server.py` is the service entry point (FastAPI/Uvicorn, port 3000). Install this directory's
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
budget and bounded probe concurrency. It never calls AI/model, Finder,
recommendations, payment, shipping or telemetry for storefront readiness.

Optional feature calls
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

## FastAPI transport and operational contract

`asgi_app.py` owns HTTP routing, explicit-origin CORS, security headers, request IDs,
structured category-only logs and bounded dispatch. `api_models.py` defines validated
AI/checkout request contracts and AI/health responses. `server.py` retains domain
routing and authorization; `auth.py`, `user_client.py`, `llm.py` and moks
retain identity, downstream calls, configuration and provider responsibilities.
`lifecycle.py` owns Mongo clients, the commerce store, event and purchase workers.

The API remains buffered JSON, including chat; there was no SSE protocol to migrate.
No tokens are sent until generation completes. Cancellation drains an already-running
worker without replaying generation, cart mutations, or payment calls. At most eight
blocking handlers execute concurrently; saturation returns 503. Body reads have a
10-second budget and 64-KiB transport cap (ordinary JSON remains 16 KiB); headers are
limited to 16 KiB. Downstream HTTP socket timeouts consume a shared 23-second budget,
with existing smaller per-service bounds retained. Python cannot forcibly interrupt
an in-flight blocking SDK/DB call: its own timeout still applies, and cancellation
must not be mistaken for payment failure. Ambiguous orders retain their reservations.
The agent's existing total generation deadline, cached checks and per-replica circuit
breaker remain authoritative; no gateway fallback or generation retry was added.
Frontend AI timeouts and NGINX budgets remain above the agent's generation budget.

- `GET /health/live` (and legacy `/health`) checks the running process.
- `GET /health/ready` (and legacy `/api/ready`) checks Mongo, catalogue, user-service,
  ledger writer and configured Redis cart service with bounded probes.
- `GET /api/admin/llm/status` requires superadmin authentication and returns only
  configured provider/model, revision, configuration status and failover opt-in.
  When configured, it includes the agent’s cached, revision-matched health snapshot
  with a one-second fetch bound. These checks are model-list/TLS checks, not proof that
  generation will succeed; stale/missing data is an empty map. No endpoint URLs or
  credentials are exposed.
- `/api/admin/llm` and its test/disconnect routes retain revision CAS and audit.
- No provider: chat retains HTTP 200 for existing clients, with
  `code: LLM_NOT_CONFIGURED`, `error`, `answer` and `notice` saying
  **Please connect an LLM to get results.** Finder shows the same message.
- Missing/broken optional AI or telemetry never makes core readiness fail.

Bedrock continues to use the workload IAM credential chain, never UI-supplied keys.
Ollama destinations must be deployment allowlisted. Explicitly enabling fallback
requires successful tests of both configurations. The agent makes at most one primary
and one eligible fallback attempt; refusals, invalid input and authorization failures
never trigger fallback. Disconnect invalidates further attempts. Bedrock usage is
chargeable and sends inference data to AWS; the existing opt-in setting explains this.

JSON storage still requires **one process and one replica** with its exclusive writer
lock. PostgreSQL supports multiple gateway instances with Redis cart revision handling.
No Compose or Helm gateway configuration exists in this repository; none was invented.
The service Dockerfile remains non-root and runs one Uvicorn worker. Minikube probes
now use the explicit live/ready endpoints; legacy URLs remain compatible.

### Local startup and verification

From the repository root, using an isolated local MongoDB and existing local dependent
services (not production credentials):

```bash
python3 -m venv /tmp/roboshop-gateway-venv
/tmp/roboshop-gateway-venv/bin/pip install -r services/ai-gateway/requirements.txt
# Load your local environment using the variable names in .env.example.
set -a
. services/ai-gateway/.env.local
set +a
/tmp/roboshop-gateway-venv/bin/python services/ai-gateway/server.py
```

In another terminal:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
curl -i http://127.0.0.1:3000/api/status
curl -s http://127.0.0.1:3000/openapi.json
```

Readiness correctly returns 503 until essential local services are available.
The checked-in `.env.example` is secret-free; create `.env.local` with local-only
credentials and do not commit it. No LLM or AWS credential is required for liveness
or to demonstrate the not-configured response.

## Reviewed commerce invariants

All accepted checkout keys are session-scoped durable aliases, including keys accepted
while another order is pending. They survive payment, cart refill and restart, and the
JSON importer preserves them when moving to PostgreSQL. They never change order money.
New payments are accepted only in INR. Unquoted INR carts are allowed; conversion
requires a current, signed, session/revision/mode-bound quote. Existing orders keep their
original currency for reconciliation. The frontend converts checkout to INR independently
of the storefront display preference and requires a refreshed quote when rates are unavailable.

Archiving changes catalogue visibility, not capacity. Pending reservations block archive.
Unarchiving preserves sold/reserved balances. PostgreSQL capacity edits require the
existing audited adjustment API. Gateway catalogue reads/reservations and admin archive
writes share a PostgreSQL advisory gate across replicas (no database transaction spans
catalogue HTTP). All catalogue visibility writers must use this gate; direct Mongo writes
or external bulk import bypass it and must be coordinated offline. Provider creation runs
after the gate is released. JSON uses its existing in-process catalogue lock.

### Explicit purchase-provenance repair

Purchase projection remains insert-only. Verified reviews require captured live merchant
purchases with explicit non-demo/non-synthetic order and matching item provenance.
Missing provenance is never inferred from a product's current catalogue state.

Back up the user database and obtain a read-only authoritative ledger snapshot first.
With `USER_MONGODB_URL` pointing at the intended user database, dry-run:

```bash
python services/ai-gateway/provenance_backfill.py \
  --ledger /path/to/reviewed/store.json --database roboshop_users \
  > provenance-review.jsonl
```

Review candidates/conflicts before explicitly applying:

```bash
python services/ai-gateway/provenance_backfill.py \
  --ledger /path/to/reviewed/store.json --database roboshop_users \
  --apply --actor operator@example.com > provenance-applied.jsonl
```

For PostgreSQL source snapshots replace `--ledger /path/to/reviewed/store.json` with
`--postgres` and set `COMMERCE_DATABASE_URL` to that authoritative ledger. Source access
uses a read-only transaction. The tool matches order/customer/mode/currency/amount,
requires matching explicit capture/synthetic flags, repairs missing fields (including
legacy unknown/empty provenance), refuses conflicting
values and CAS-checks the old document. Each repair appends `provenanceAudit` atomically.
Repeat runs are safe; financial fields are never changed. Conflicts need manual review.
The tool is never invoked at startup or deployment, and was tested only with isolated data.

## Product image uploads

Admins upload product images from the admin editor; nobody types asset paths. `POST /api/admin/product-images` (admin/superadmin, same-origin, `{"image":"data:image/...;base64,..."}`, at most 1.5 MB, the only API body allowed above 64 KiB in both NGINX and ASGI) decodes JPEG/PNG/WebP with Pillow, rejects animations, decompression bombs and images under 200 px, flattens and resizes to at most 1600 px, and stores a fresh JPEG in MongoDB `product_images` keyed by its SHA-256 prefix. `GET /api/product-images/<id>.jpg` is public and immutable-cached. Product saves accept only uploaded images or paths the static routes actually serve (`/product-media/*.jpg|png`, `/images/*.png`); an unchanged legacy path stays editable. Reference/showcase images still need a reviewed provenance update.

`runtime.UserError` marks fixed, operator-facing messages (admin validation and conflicts) that the ASGI layer may return verbatim; plain `HttpError` text stays masked. Never put input values or secrets in a `UserError`.
