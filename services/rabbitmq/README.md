# RabbitMQ order events

`compose.yml` owns the broker deployment and mounts `rabbitmq.conf`. Start with
`docker compose up -d rabbitmq` from the repository root after setting
`RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in `.env`. The named `rabbitmq-data` volume
and stable hostname preserve broker state across container replacement. AMQP 5672
and management 15672 are published on host loopback only.

The gateway declares durable exchanges and quorum queues, publishes `order.paid`
with confirms, and retains unconfirmed events in its outbox. Java shipping commits
an idempotent shipment request before acknowledging. Failed processing is retried
and dead-lettered to `robotshop.shipping.failed`. Queue declarations belong to the
applications; the broker configuration does not duplicate them.

This is one broker for local development, not a fault-tolerant quorum cluster.
Production Helm uses external RabbitMQ with verified TLS via the integration
Secret. Plan broker replication, disk monitoring, backups and controlled DLQ replay.
Never delete the data volume to resolve a queue declaration error.
