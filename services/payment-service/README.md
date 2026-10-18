# RobotShop payment service — Razorpay

Replaces the dummy legacy payment behavior in the active application, while preserving
the original source under `legacy/`. The active implementation uses Node built-ins,
port 4105, and Razorpay's REST API plus hosted Standard Checkout. The old Flask payment
service remains a simulator and is not used by the new checkout.

## Activate live payments

1. Use an activated Razorpay merchant account and generate its live key ID and secret.
2. Set PAYMENT_MODE=live, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
   RAZORPAY_WEBHOOK_SECRET, and an HTTPS PUBLIC_ORIGIN in `.env`.
3. Set PAYMENT_SERVICE_TOKEN to a random secret for Compose/Helm. The local dev launcher
   generates one when blank. Only the gateway and payment service receive this token.
4. Configure the public HTTPS webhook `/api/payments/webhook` for `payment.captured`,
   using the same webhook secret. Enable automatic payment capture in Razorpay.
5. Restart. The storefront enables Pay securely only when configuration is present.

The public key ID goes to Checkout; secret keys never reach the browser. No card data
is collected by RobotShop. The amount is calculated from the server's catalogue in
integer EUR cents. Your account must support EUR/international payments. The existing
fictional catalogue does not become a real fulfilment operation through this integration.

For sandbox testing, use PAYMENT_MODE=test and test keys. No mock-provider switch exists
in production code. Tests inject a fake fetch implementation directly into the adapter.

## Payment lifecycle

`POST /api/payments/orders` snapshots and reserves the authenticated anonymous cart,
then creates a Razorpay order. Idempotency keys and one pending order per session avoid
parallel checkout creation. The browser receives only the public Checkout configuration.
Cart changes are locked while that payment is pending.

`POST /api/payments/verify` verifies HMAC-SHA256 using the server-stored order ID, then
fetches payment details from Razorpay. Captured status, amount, currency, order ID and
zero refunded amount must match. Only then is inventory sold and the cart cleared.

`POST /api/payments/webhook` validates HMAC over exact raw bytes and reconciles captured
payments server-side. Duplicate events and callbacks are idempotent. GET status/current
supports recovery when a browser callback was missed. No browser success flag alone
can confirm payment. The previous `POST /api/orders` demo endpoint returns HTTP 410.

Internal `/api/payment/*` routes require X-Payment-Service-Token. Credentials are confined
to the payment process. Request bodies, signatures, secrets and payment details are not
included in application logs or trace attributes.

## Operational boundaries

The order ledger still requires a single gateway writer. Back up `.data/store.json`
(or the container volume). Do not scale the gateway or run multiple local launchers
against the same file. A database/outbox migration is needed for resilient production
operations. No live activation/deployment is performed by the code change.

If creating a provider order times out, the local order enters payment_review and keeps
its reservation; it is not retried blindly. Reconcile the local order's UUID against the
Razorpay receipt in the merchant dashboard before recovery. Abandoned checkouts also
retain reservations: automatic cancellation/release/refunds are not implemented because
the provider order could still be paid. Do not delete ledger records for charged orders.
Refunds, disputes, tax/shipping calculation and fulfilment remain merchant operations.

Reference: [Razorpay integration steps](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/),
[webhook validation](https://razorpay.com/docs/webhooks/validate-test/).
