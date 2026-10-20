# AI gateway

Port 3000 serves the storefront, catalogue, recommendations, chat, cart and operations.
POST `/api/cart` accepts `{"sku":"RMC","quantity":2}` with absolute quantity (0 removes).
`/api/payments/config`, `/api/payments/orders`, `/api/payments/verify`,
`/api/payments/current`, `/api/payments/status?orderId=...` and `/api/payments/webhook`
implement Razorpay checkout. Order creation requires login and an Idempotency-Key header.
`POST /api/orders` returns 410; demo checkout is removed.

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
reentrant lock serializes ledger writes and inventory/admin checkout operations.
The background Pika publisher uses durable quorum queues, mandatory routing and
publisher confirms before marking outbox entries delivered. Delivery is at least
once; the Java shipping consumer deduplicates event IDs.

Additional endpoints are `/api/compare` (2–4 distinct SKUs) and authenticated
`/api/recommendations/personalized` (cart categories). MCP tools call these and the
same authenticated cart/admin endpoints; MCP never bypasses authorization.

Private customer profiles, successful login metadata, saved addresses and immutable
paid purchase history now live in MongoDB. The gateway retries pending history
projections from its ledger. See [customer records](../../docs/architecture/customer-records.md)
for access rules, retention, backfill behavior and the remaining single-writer limit.

## Independent service build

Run `docker build -t robotshop-ai-gateway:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).

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
