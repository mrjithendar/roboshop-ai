# ADR 0002: Razorpay checkout replaces demo orders

User selected live payments through Razorpay. Supersedes ADR 0001's no-real-payments
scope. Preserve the legacy snapshot, replace its dummy payment behavior in the active
service layer, and expose provider-hosted Checkout instead of collecting card data.

Use server-calculated EUR cents, signed verification plus captured-payment API checks,
idempotent order completion, stock reservations, and signed webhooks with status recovery.
No live keys, account activation, real charge, or public deployment is implied by this
implementation. See services/payment-service/README.md for operational limitations.
