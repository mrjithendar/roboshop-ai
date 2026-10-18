# AI gateway

Port 3000 serves the storefront, catalogue, recommendations, chat, cart and operations.
POST `/api/cart` accepts `{"sku":"RMC","quantity":2}` with absolute quantity (0 removes).
`/api/payments/config`, `/api/payments/orders`, `/api/payments/verify`,
`/api/payments/current`, `/api/payments/status?orderId=...` and `/api/payments/webhook`
implement Razorpay checkout. Order creation requires an Idempotency-Key header.
`POST /api/orders` returns 410; demo checkout is removed.

Prices and stock are server-authoritative. Pending payments reserve stock and lock cart
changes. Captured payments are confirmed exactly once. Session ownership protects
payment status/verification. Webhooks authenticate raw bytes rather than browser origin.
Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS. Mutation origins are checked.
DATA_DIR defaults to `.data/`. Only one process may write this ledger.
See [payment-service](../payment-service/README.md) for activation and recovery boundaries.
