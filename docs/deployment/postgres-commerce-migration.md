# PostgreSQL commerce migration

This is a separate, opt-in migration. Existing manifests still select the JSON
backend and one replica. No running deployment or customer data is changed by
checking out this code. A read-only audit of the ignored local `.data/store.json` found two sessions and four
older EUR `demo-confirmed` orders, all without a stored payment mode, and no
`testSold` counter. That file was not changed, backed up by the importer or migrated.
Those historical records require explicit reconciliation before cutover: the importer
rejects unknown payment modes/states instead of classifying them as captured/test/live.
All migration verification used generated fixtures and isolated PostgreSQL 17/Redis.

## Storage contract

The gateway accepts `COMMERCE_BACKEND=json` (legacy default) or `postgres`. PostgreSQL
requires `COMMERCE_DATABASE_URL` and the existing authenticated Redis cart service.
An unavailable database never falls back to JSON. A PostgreSQL gateway never writes
the JSON file. Schema creation and import are explicit operator commands, not startup
hooks. Existing MongoDB users, profiles, reviews and products are not moved/deleted.

`services/ai-gateway/sql/001-commerce.sql` creates:

| Table | Responsibility |
| --- | --- |
| commerce_sessions | Account/cart ownership, cached Redis snapshot/revision, shipping quote |
| commerce_orders | Immutable checkout identity, original amount/currency/mode/timestamps and payment state |
| commerce_order_items | Original line-item snapshots and quantities |
| commerce_inventory | Capacity, sold and reserved units, independently for test/live |
| commerce_reservations | Per-order held/consumed inventory |
| commerce_adjustments | Idempotent, attributed capacity changes and migration baselines |
| commerce_checkout_keys | Unique session/key bindings, including duplicate request aliases |
| commerce_outbox | Durable event and purchase-projection jobs, leases and delivery markers |
| commerce_imports | Import checksum, reconciliation report and rollback fingerprint |

Amounts use integer minor units in the order table; complete original JSON snapshots
retain the original price numbers, currency, timestamps, order IDs, shipping and demo
provenance. PostgreSQL's typed timestamp normalizes an instant for querying; the
original timestamp string remains in the snapshot. A database trigger prevents
changes to checkout financial/identity/provenance fields and captured-state regression.
The importer supports the existing two-decimal INR/USD/EUR commerce contract; it
rejects other currencies for explicit minor-unit review, rather than converting them.

The primary/unique constraints prevent duplicate orders, idempotency keys, payment
IDs and multiple pending orders for a cart. Inventory constraints prohibit negative
balances and `sold + reserved > capacity`. New reservations lock inventory rows in
SKU order, validate stock, then insert the order, lines, keys and reservations in
one transaction. `mark_paid` validates the existing captured-payment evidence under
an order row lock, consumes reservations and inserts outbox jobs in one transaction.

## State machine and external systems

1. The gateway reads catalogue/payment configuration outside a commerce transaction.
2. Under a per-cart PostgreSQL advisory gate, it refreshes Redis and checks the
   expected cart revision. It commits an immutable order (`creating`), original
   payment environment/key ID, amount, snapshot and reservation before the provider call.
3. Only the request that created the durable order may call provider creation.
   Duplicate requests return the existing pending order and bind their key to it;
   those aliases continue to resolve to the same order after capture/new cart edits.
4. A matching provider response transitions to `payment_pending` with revision
   validation. A timeout or exception transitions to `payment_review`, never to
   cancelled. A creation left by a dead worker becomes `payment_review` when read
   after its two-minute deadline. Restarting another replica does not demote a live
   creation immediately. Recovery looks up the original receipt/environment; it
   never blindly creates another provider order.
5. Verified capture transitions to `paid`, consumes held inventory and inserts both
   outbox jobs atomically. Existing amount/currency/signature/capture/ownership/replay
   checks remain in the gateway/payment service. Test events remain `order.test-paid`;
   only explicit live merchant events reach the shipping queue.

No transaction spans Redis, Razorpay, RabbitMQ or MongoDB. The advisory cart gate
is connection-scoped and spans bounded Redis calls, **without an open SQL transaction**.
It serializes only that cart across replicas and releases when the process dies.
All editable cart writes must go through the gateway; the private cart-service token
must not be used by independent writers that bypass this gate.

Redis is authoritative for editable items. PostgreSQL caches the last observed
items/revision for recovery and records both the cart revision and Redis revision
on the checkout snapshot. If Redis writes succeed and SQL cache writes fail, the
next sync accepts Redis, advances the cache revision and invalidates the old quote
when items changed. Stale checkout revisions are rejected. Pending orders freeze
cart/shipping edits; Redis expiry cannot change the committed order snapshot.
After payment, idempotent Redis clearing completes before cart edits resume. The
SQL cache is also cleared so an expired Redis key cannot resurrect a paid cart.
The new `/clear-checked` cart-service operation uses Lua to require the frozen Redis
revision; a newer cart is preserved and blocked for operator reconciliation. An
imported paid order without a Redis revision can only acknowledge an already-empty
or missing cart automatically. `unversionedCartClears` lists these cases in the
migration report. An older cart-service image rejects the new path without clearing
anything; deploy the new cart-service image completely before PostgreSQL cutover.
Guest adoption rotates cart IDs; a guest cookie never becomes account authorization.

Outbox workers claim small batches with `FOR UPDATE SKIP LOCKED`, 120-second leases
and fencing tokens. Delivery is **at least once**, not exactly once. A crash after
publish/projection but before acknowledgement can cause a duplicate. A stale worker
cannot acknowledge a newly claimed job. RabbitMQ uses publisher confirms and the
same durable `eventId`; shipping already deduplicates by order/event ID in SQL.
Purchase projection uses the original order ID and the user service's immutable
MongoDB `$setOnInsert` upsert. Failed deliveries retry after lease expiry; there is
no automatic reservation expiry or browser-dismissal release.

## Inventory administration

For migration, provide a reviewed baseline covering every sold/reserved SKU/mode.
Capacity means total units allocated to that environment, including already sold
and reserved units, not merely remaining stock. Example **test fixture**:

```json
[
  {"sku": "EXAMPLE", "mode": "test", "capacity": 50},
  {"sku": "EXAMPLE", "mode": "live", "capacity": 20}
]
```

The importer rejects overcommitment and sold counters smaller than paid quantities.
Older ledgers lacking `testSold` are split using explicitly recorded paid test
orders; the report records the transformation and preserves total sold units.
Residual sold counts without corresponding order history are preserved and counted
as `unattributedSoldUnits` for operator review.

For a new SKU absent from the inventory table, the first reservation initializes
capacity from the catalogue's validated stock snapshot exactly once. Thereafter,
PostgreSQL is authoritative; repeated catalogue reads/imports cannot replenish it.
The normal admin editor rejects stock changes in PostgreSQL mode. Use a reviewed
operator invocation of `PostgresStore.adjust_inventory(sku, mode, delta, key, actor,
reason)` for replenishment/corrections. It requires a unique retry key, actor and
reason and rejects reductions below sold + held units. This is not a new public
HTTP endpoint. Keep the database operator credential separate from application use.

## Offline cutover (operator-run only)

Use a dedicated commerce database and role, not the shipping database/schema. Keep
its DSN in the existing `roboshop-secrets` Secret under `COMMERCE_DATABASE_URL`; keep
`COMMERCE_BACKEND` in the consolidated `roboshop-config`. TLS, backups/PITR, least
privilege, capacity planning and credential provisioning remain operator tasks.
The runtime role needs DML on commerce tables, not schema-owner privileges. Run the
schema command with a separate migration role, then grant runtime privileges.

1. Pause checkout and stop **all** JSON gateways and their publishers/projectors.
   Keep the original JSON file/PVC, Redis persistence and payment credentials.
   Queue/retain webhooks for replay; don't release reservations or take new payments.
2. Take normal PostgreSQL/Redis backups. Copy the frozen JSON ledger and prepare
   the reviewed inventory baseline. The importer additionally acquires the legacy
   `writer.lock` beside the supplied source and refuses an active writer there. When
   supplying a copy, stopping the original writer before copying remains an operator
   responsibility. PostgreSQL gateway processes
   hold shared lifecycle locks; schema/import/rollback checks require the exclusive
   lifecycle lock. Do not use transaction-pooling proxies for these session locks.
3. Install the gateway dependencies in an isolated operator environment. Set
   `COMMERCE_DATABASE_URL` securely; do not pass passwords on a command line or
   include them in reports. Apply the schema explicitly:

```bash
python services/ai-gateway/commerce_migrate.py \
  --init-schema --report /secure/migration/schema-report.json
```

4. Dry-run (the default; no database writes):

```bash
python services/ai-gateway/commerce_migrate.py \
  --source /secure/migration/store.json \
  --inventory /secure/migration/inventory.json \
  --backup-dir /secure/migration/backups \
  --report /secure/migration/dry-run.json
```

Backups are byte-for-byte, checksum-addressed, created with mode 0600 and fsynced.
The combined checksum covers source JSON **and** inventory baseline. Reports include
errors/warnings, counts, minor-unit totals by original mode/currency, reserved/sold
units, creation-state recovery, missing original payment credentials and paid orders
without a projectable account ID. Reports contain identifiers and should be protected.
Missing modes, conflicting identities, malformed money/totals, duplicate events,
missing sessions and unknown states fail validation. Unknown original credentials
are preserved and reported; they are never replaced with today's live credentials.
Already-delivered event/projection flags remain delivered. No fake captures or event
identities are generated for incomplete historical paid orders.

5. Review **every** report warning before applying. Resolve problems through a
   separately reviewed source-reconciliation procedure; do not edit amounts/modes
   just to pass validation. Apply with exactly the same files:

```bash
python services/ai-gateway/commerce_migrate.py \
  --source /secure/migration/store.json \
  --inventory /secure/migration/inventory.json \
  --backup-dir /secure/migration/backups \
  --report /secure/migration/applied.json --apply
```

The target must be empty. One transaction imports all commerce rows and records the
checksum. A crash before commit leaves no partial import; rerun the same command.
A crash after commit is recognized by checksum and returns `alreadyImported` without
rewriting rows. There is no merge mode, dual-write mode or automatic data migration.
The source file, existing user database and Redis contents are never modified by import.

6. Reconcile report counts/totals against the frozen source. Check missing original
   credentials, ambiguous orders and undelivered jobs. Retain environment-specific
   Razorpay credentials so old test/live orders reconcile in their original account.
7. Only after validation, deploy the new gateway image with `COMMERCE_BACKEND=postgres`,
   the DSN and Redis cart configuration. Do not run any JSON gateway concurrently.
   Replay queued webhooks and let outbox workers recover pending deliveries. Monitor
   pending states, oldest outbox age, attempts and inventory balances.
8. The isolated four-process stock contention tests passed before enabling support
   for multiple PostgreSQL gateways. Scale only PostgreSQL gateways after cutover;
   keep JSON at one replica. Existing deployment manifests remain unchanged on purpose.
   Remove JSON volume requirements from the new deployment only after preserving its
   backup; do not delete the old PVC as part of cutover. Validate normal rollout,
   database failover and workload capacity in staging before production scale-out.

## Rollback

Rollback to the frozen JSON ledger is supported **only before PostgreSQL state has
changed after import**. Stop all gateways/workers and run:

```bash
python services/ai-gateway/commerce_migrate.py \
  --rollback-check IMPORT_CHECKSUM \
  --report /secure/migration/rollback-report.json
```

This compares a deterministic fingerprint of all commerce tables with the committed
import baseline under the exclusive lifecycle lock. Even cart changes or outbox
claims make rollback unsafe. On success, verify the checksum-addressed backup against
the frozen source, restore that backup to the original JSON data directory, select
`COMMERCE_BACKEND=json` and start exactly one JSON gateway. Preserve PostgreSQL and
all backups for investigation; the checker deletes nothing.

If the check fails, **do not restore old JSON**: it would lose new orders/reservations
or delivery markers. Roll forward, reconcile payments and repair PostgreSQL. A reverse
migration after accepting new commerce needs a separate reviewed project, including
inventory adjustments and delivery reconciliation; this implementation deliberately
does not provide an unsafe export-and-overwrite rollback.

## Repeatable isolated verification

The opt-in suite refuses non-loopback PostgreSQL hosts or database names not ending
in `_test`, and Redis must use loopback database 15. It truncates only that explicitly
supplied test database and flushes Redis DB 15. Never point it at a shared environment.
Start fresh local PostgreSQL and Redis instances and create an empty UTF-8 database:

```bash
export COMMERCE_TEST_DSN='postgresql://127.0.0.1:55439/roboshop_commerce_test'
export COMMERCE_TEST_REDIS='redis://127.0.0.1:56389/15'
python -m unittest discover -s tests/commerce -v
python -m unittest discover -s tests/python
```

Tests use real isolated PostgreSQL/Redis and mocked payment providers. They cover
multiprocess limited-stock contention, duplicate/alias requests, immutable financial
snapshots, payment replay, webhook recovery/retries, process death, SQL rollback,
Redis/SQL partial failure, expired cart clearing, lease fencing, retry-safe purchase
projection, import restart/validation/fidelity and rollback refusal after new work.
No real payment, user migration or running Kubernetes deployment is part of testing.
