# AI gateway

Runs on port 3000. Serves the storefront and `/api/products`, `/api/recommendations`,
`/api/chat`, `/api/cart`, `/api/orders`, `/api/ops`, `/api/status`, and `/api/ready`.
`/health` is liveness; `/metrics` exposes Prometheus counters and duration summaries.
POST cart body: `{"sku":"RMC","quantity":2}`. Quantity is absolute, 0 removes.
POST orders requires `{"confirmDemo":true}` and an `Idempotency-Key` header.
Prices and stock are calculated server-side. Cookies are HttpOnly and SameSite=Strict;
Secure is enabled when PUBLIC_ORIGIN uses HTTPS. Mutation origins are checked.
DATA_DIR defaults to `.data/`. Exactly one gateway process may write this ledger.
