-- Explicit migration only. Never executed by application startup.
CREATE TABLE IF NOT EXISTS commerce_schema (version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS commerce_sessions (
 id text PRIMARY KEY, user_id text UNIQUE, expires double precision NOT NULL,
 data jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE IF NOT EXISTS commerce_inventory (
 sku text NOT NULL, mode text NOT NULL CHECK (mode IN ('test','live')),
 capacity bigint NOT NULL CHECK(capacity >= 0), sold bigint NOT NULL DEFAULT 0 CHECK(sold >= 0),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0),
 PRIMARY KEY(sku,mode), CHECK(sold + reserved <= capacity)
);
CREATE TABLE IF NOT EXISTS commerce_orders (
 id text PRIMARY KEY, session_id text NOT NULL REFERENCES commerce_sessions(id),
 status text NOT NULL CHECK(status IN ('creating','payment_review','payment_pending','paid')),
 revision bigint NOT NULL CHECK(revision >= 0),
 amount bigint NOT NULL CHECK(amount >= 0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 mode text NOT NULL CHECK(mode IN ('test','live')), payment_key_id text,
 provider_order_id text, payment_id text,
 created_at timestamptz NOT NULL, snapshot jsonb NOT NULL,
 UNIQUE(mode,payment_key_id,provider_order_id), UNIQUE(mode,payment_key_id,payment_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_one_pending_cart ON commerce_orders(session_id)
 WHERE status IN ('creating','payment_review','payment_pending');
CREATE TABLE IF NOT EXISTS commerce_checkout_keys (
 session_id text NOT NULL REFERENCES commerce_sessions(id), key text NOT NULL,
 order_id text NOT NULL REFERENCES commerce_orders(id), PRIMARY KEY(session_id,key)
);
CREATE TABLE IF NOT EXISTS commerce_order_items (
 order_id text NOT NULL REFERENCES commerce_orders(id), sku text NOT NULL,
 quantity integer NOT NULL CHECK(quantity > 0), snapshot jsonb NOT NULL,
 PRIMARY KEY(order_id,sku)
);
CREATE TABLE IF NOT EXISTS commerce_reservations (
 order_id text NOT NULL REFERENCES commerce_orders(id), sku text NOT NULL, mode text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity > 0), state text NOT NULL CHECK(state IN ('held','consumed')),
 PRIMARY KEY(order_id,sku), FOREIGN KEY(sku,mode) REFERENCES commerce_inventory(sku,mode)
);
CREATE TABLE IF NOT EXISTS commerce_adjustments (
 id text PRIMARY KEY, sku text NOT NULL, mode text NOT NULL, delta bigint NOT NULL,
 actor text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(sku,mode) REFERENCES commerce_inventory(sku,mode)
);
CREATE TABLE IF NOT EXISTS commerce_outbox (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES commerce_orders(id),
 kind text NOT NULL CHECK(kind IN ('event','purchase')), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
 lease_until timestamptz, lease_token text, attempts integer NOT NULL DEFAULT 0,
 UNIQUE(order_id,kind)
);
CREATE INDEX IF NOT EXISTS commerce_outbox_pending ON commerce_outbox(kind,created_at) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS commerce_imports (
 checksum text PRIMARY KEY, source_name text NOT NULL, report jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
-- Freeze original checkout identity and financial/provenance data independently of Python.
CREATE OR REPLACE FUNCTION commerce_immutable_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.session_id,NEW.amount,NEW.currency,NEW.mode,NEW.payment_key_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.session_id,OLD.amount,OLD.currency,OLD.mode,OLD.payment_key_id,OLD.created_at)
 OR (NEW.snapshot - ARRAY['status','revision','razorpayOrderId','paymentId','paymentCaptured','paidAt','shipmentEvent','cartCleared','customerSyncedAt','reconciliationAudit'])
    IS DISTINCT FROM (OLD.snapshot - ARRAY['status','revision','razorpayOrderId','paymentId','paymentCaptured','paidAt','shipmentEvent','cartCleared','customerSyncedAt','reconciliationAudit'])
 THEN RAISE EXCEPTION 'Immutable checkout snapshot cannot change'; END IF;
 IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN RAISE EXCEPTION 'Captured orders cannot regress'; END IF;
 IF OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN RAISE EXCEPTION 'Provider identity cannot change'; END IF;
 IF OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN RAISE EXCEPTION 'Payment identity cannot change'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commerce_order_immutable ON commerce_orders;
CREATE TRIGGER commerce_order_immutable BEFORE UPDATE ON commerce_orders FOR EACH ROW EXECUTE FUNCTION commerce_immutable_order();
INSERT INTO commerce_schema VALUES(1) ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_provider_identity ON commerce_orders(mode,coalesce(payment_key_id,''),provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payment_identity ON commerce_orders(mode,coalesce(payment_key_id,''),payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE commerce_orders ADD COLUMN IF NOT EXISTS creation_deadline timestamptz NOT NULL DEFAULT (now()+interval '2 minutes');
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payment_replay ON commerce_orders(payment_id) WHERE payment_id IS NOT NULL;
