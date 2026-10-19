# Cart service

Private HTTP service on port 4107, inspired by the legacy Redis cart service. It stores quantities with a seven-day sliding expiry, validates quantities, and applies compare-and-set revisions atomically with Redis Lua. Payment clearing is idempotent by order ID. It does not accept browser cookies or expose a public ingress; only the authenticated gateway may call it.

The gateway retains session ownership, catalogue pricing, stock checks, shipping, payment locks, and order snapshots. Its existing durable ledger backs up quantities for recovery after Redis eviction/restart. Redis remains a shared cache, not the payment ledger. This is still a **single-writer gateway** deployment; scaling the gateway requires replacing its local ledger/lock with transactional shared storage.

Build/deploy from repository root: `bash build-images.sh` then `bash deploy-minikube.sh --load-images`. All eleven application images use `:local`. Existing carts migrate lazily on access. No data deletion is required.
