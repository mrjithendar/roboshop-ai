CREATE TABLE shipping.shipment_requests (
    order_id uuid PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested')),
    received_at timestamptz NOT NULL DEFAULT now()
);
