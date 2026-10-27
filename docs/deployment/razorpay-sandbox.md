# Razorpay sandbox checkout

The default is `PAYMENT_MODE=test`, including Minikube. Checkout displays **Demo
checkout — no real money charged**. The bundled concept catalogue is demo inventory,
not a fulfilment promise. Display-only/reference listings remain non-purchasable.
Demo sale listings can be purchased only with Razorpay Test Mode. The gateway and
payment service reject live checkout for demo/synthetic/simulated inventory.

## Configure the demo

Keep `PAYMENT_MODE: test` in `minikube/roboshop/roboshop-ai-namespace.yaml, minikube/roboshop/roboshop-config-configmap.yaml`. Use the same ConfigMap
for gateway and payment service so storefront stock availability reflects the
selected mode. In the existing `roboshop-secrets` Secret, configure:

- `RAZORPAY_TEST_KEY_ID` (starts with `rzp_test_`)
- `RAZORPAY_TEST_KEY_SECRET`
- `RAZORPAY_TEST_WEBHOOK_SECRET` (choose a distinct secret for the test webhook)
- Existing `PAYMENT_SERVICE_TOKEN` (preserve it)

Use your secret manager or a permission-restricted Secret manifest; never put
values in Git, chat, screenshots or command history. The payment Deployment already
references these optional keys. Apply the manifests and roll out rebuilt gateway,
payment, catalogue/ingestion, frontend and shipping images using the repository
workflow. Prefer deploying the shipping guard first, then payment/gateway and the
storefront. Restart the payment Deployment when changing environment-backed secrets.
There is no automated switch to a fake provider in deployed application code.

In the Razorpay **Test Mode** dashboard, configure payment auto-capture and a
`payment.captured` webhook to `https://jithendar.com/roboshop/api/payments/webhook`
(the ingress forwards `/roboshop/api/...` to `/api/...`). Use the same test webhook
secret in Razorpay and Kubernetes. Confirm the actual ingress prefix for your host.
Only captured, matching payments can complete an order; an authorization alone
remains pending.

For later live operation, retain the test keys and add `RAZORPAY_LIVE_KEY_ID`,
`RAZORPAY_LIVE_KEY_SECRET`, and a **different** `RAZORPAY_LIVE_WEBHOOK_SECRET`.
Live also requires an HTTPS `PUBLIC_ORIGIN`. Changing the shared mode controls new
orders, not old orders. Known demo snapshots on historical live orders cannot be resumed for
a new charge, but existing captures can still be reconciled. Reconciliation/resume selects the order's original mode
and exact public key ID. Missing/rotated original keys fail closed; restore that
credential set before reconciling. One account/key per environment is supported,
not an arbitrary archive of rotated keys. Legacy `RAZORPAY_KEY_ID/KEY_SECRET/
WEBHOOK_SECRET` still work only in the environment identified by the key prefix.
Do not configure the same webhook secret for both environments: ambiguous HMAC
matches are rejected.

## State, inventory and delivery

Each durable order freezes payment mode/key ID, amount/currency, idempotency key,
cart revision, `demo`, `synthetic`, `inventoryProvenance` and per-product provenance
before the provider order is created. None of these follow later catalogue/config
edits. The old `merchant-20-inr-v1` concept seed is recognized as demo on read;
upgrading does not overwrite merchant edits or replenish inventory. Fresh seed rows
use `demo-20-inr-v2`. Genuine sale inventory needs separately reviewed merchant
records; renaming a demo listing does not remove its provenance.

`creating → payment_pending → paid` is the normal flow. A crash/ambiguous creation
moves to `payment_review`; read-only receipt recovery can attach the existing
provider order. Dismissal, failed attempts, missing receipts and timeouts keep the
reservation. Resume reuses the same provider order. No automatic cancellation,
refund, force-paid action or reservation release is implemented while it may still
be payable. An empty provider lookup is not proof of cancellation.

Test reservations and `testSold` counters are isolated from live reservations and
`sold`. The first gateway restart migrates known historical test sales out of the
old shared counter, once, without releasing reservations. Unknown historical sales
remain conservatively in the live counter. Live fulfilment events require explicit
merchant provenance. Test/unclassified events use `order.test-paid` and the durable
`roboshop.test.orders` audit queue, never the shipping queue. The Java shipping
consumer independently rejects test/unclassified events even if misrouted. Monitor
and manage retention of the test audit queue. Existing shipment-request rows from
older deployments are not automatically deleted; audit those separately before
connecting a delivery integration.

Purchase history preserves mode/provenance and labels test purchases. Real spending
summaries exclude test/demo purchases. A genuine verified-purchase badge requires
captured live payment and explicit merchant provenance; historical records lacking
that evidence do not gain a badge. Callback signatures, captured status, amount,
currency, ownership and replay protections remain enabled in both environments.

## Audited operator reconciliation

Log in as superadmin. Using the same-origin browser console avoids copying session
cookies into a terminal (replace the example UUID/revision with values from GET):

```javascript
const base = '/roboshop/api/admin/test-orders';
const listing = await (await fetch(base, {credentials: 'same-origin'})).json();
console.table(listing.orders.map(({id, status, revision}) => ({id, status, revision})));
const response = await fetch(`${base}/ORDER_UUID/reconcile`, {
  method: 'POST', credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({revision: 1, reason: 'Customer closed browser after provider timeout'})
});
console.log(response.status, await response.json());
```

Only current-revision test orders are accepted. Customer/admin roles and cross-origin
mutations are rejected. The ledger durably records actor, time, reason, order
revision and requested/result/error outcomes. Provider calls happen outside the
ledger lock. A gateway crash can leave a `requested` audit entry: rerun after
inspecting status; reconciliation is read-only and retry-safe. Retain the ledger
backup; per-order audit retains the most recent 1,000 entries. This procedure never
releases stock or manufactures payment success. For an unresolved provider order,
inspect the Test Mode dashboard and retain the reservation. Do not delete the ledger
or remove keys to simulate cancellation. Gateway remains one process/one replica.

## Manual sandbox checklist (no real payments)

Use only Test Mode and official test instruments. Razorpay documents a mock bank
success/failure flow, test UPI IDs `success@razorpay` / `failure@razorpay` where
available, and domestic Visa test card `4100 2800 0000 1007` with a random CVV and
future expiry. Do not use real cards, bank logins, UPI intent or QR payment apps.
See the [official Standard Checkout test instructions](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/#2-test-integration)
and [current test-card list](https://razorpay.com/docs/payments/payments/test-card-details/).

1. Log in, add a demo sale item, enter a test delivery address, calculate shipping.
   Check the prominent demo label, INR total and `rzp_test_` Checkout key.
2. Use a test success instrument. Verify captured status in Test Mode, one paid
   local order, cleared cart, demo confirmation/history label, no verified-review
   badge and no shipment request. Live stock must be unchanged.
3. Choose mock failure. The order remains unpaid and its test stock reserved.
4. Dismiss Checkout, reload and resume. Verify the same order ID/key; no second
   provider order. Double-click/retry requests must also reuse that order.
5. Simulate a lost browser callback by closing the page after the test payment.
   Let the signed webhook or Check payment status reconcile it. Redeliver the
   webhook: there must still be one stock deduction/history row/outbox event.
6. Test an invalid callback signature or another account's order: reject both.
7. In automated mocks, switch the active mode while a test order is pending:
   old-order calls must use test credentials. Do **not** make a live payment to
   perform this check. Missing original test keys must stop reconciliation.
8. For a deliberately interrupted test checkout, run the audited procedure above.
   Missing/ambiguous receipts remain under review with their reservations held.

Automated provider checks inject fake transports. No real or sandbox Razorpay
payment is submitted by the test suite. Live provider delivery, account capability,
credentials, webhook reachability and deployed image versions require the manual
checks above; this code change does not deploy or provision infrastructure.
