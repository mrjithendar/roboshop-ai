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

MongoDB stores users, hashed login sessions, editable products and public store
settings. `auth.mjs` and `admin.mjs` implement authentication and server-enforced
roles inside this gateway. Login is mandatory for payment browser APIs; signed
provider webhooks remain independent of browser sessions. See
[identity and admin](../../docs/architecture/identity-and-admin.md).


## Python runtime

`server.py` is the service entry point (Waitress, port 3000). Install this directory's
`requirements.txt` for native execution; `npm run dev` uses the `PYTHON` environment
variable or `python3`. The image contains Python gateway code and its local libraries only.

MongoDB auth, public settings, admin role checks, CSRF/origin checks, payment
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
