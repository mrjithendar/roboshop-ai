# Shipping service

Java 21 / Spring Boot shipping service on port 4106, built with the checked-in Gradle 8.14.3 Wrapper and backed by dedicated PostgreSQL 17. No SQLite or embedded database. The application uses a bounded HikariCP connection pool, parameterized queries, query/connect timeouts, foreign keys, coordinate constraints and an indexed country/city search. Readiness checks the database and deployed seed version; SRE probes use that readiness endpoint.

The legacy Java shipping service supplies the design: country selection, city search and distance from the German warehouse (51.164896, 7.068792), charged at €0.05/km. This implementation corrects the legacy Haversine longitude calculation. These are configured shop shipping charges, not live carrier rates, delivery promises, labels or tracking.

## Database and data

The checked-in GeoNames snapshot contains 252 country/territory records and 34,167 cities across 244 of them. Countries without cities are disabled in checkout. It is worldwide major-city coverage, not every village or postal address. The legacy dump contains only 24 countries, so it was not used as the worldwide seed.

Sources: [cities15000.zip](https://download.geonames.org/export/dump/cities15000.zip), [countryInfo.txt](https://download.geonames.org/export/dump/countryInfo.txt). Downloaded 2026-10-18. Attribution: [GeoNames](https://www.geonames.org/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data is adapted into a compressed normalized snapshot; checksums and counts are in `data/manifest.json`. No runtime internet access is needed. To refresh, download those two files and run:

```sh
python3 scripts/prepare-locations.py /path/cities15000.zip /path/countryInfo.txt
npm run shipping:build
npm run shipping:migrate
```

Migrations run separately from the service, in a transaction guarded by an advisory lock. Applied SQL checksums are verified; seed replacement is atomic and repeatable. Do not edit an applied migration; add a subsequent migration and extend the runner for schema changes.

## Local startup

Copy `.env.example` to `.env`, preserving any existing credentials. Set separate strong URL-safe `SHIPPING_DB_PASSWORD` (schema owner) and `SHIPPING_APP_PASSWORD` (restricted runtime service). Then:

```sh
docker compose up -d --build
```

Compose initializes PostgreSQL on its persistent `shipping-postgres` volume, creates the runtime role with read-only location access and INSERT on shipment requests, runs the migration container, then starts shipping. Database credentials are configuration, never source constants. The initialization script runs only for a new database volume; apply equivalent grants manually when adopting an existing database. Never remove a volume to rotate credentials.

For local Node development with an existing PostgreSQL server, set `SHIPPING_DATABASE_URL` to the runtime user's connection URL and `SHIPPING_MIGRATION_DATABASE_URL` to the schema owner's URL, set `SHIPPING_DB_TLS=false` only for loopback development, then run `npm ci`, `npm run shipping:build`, `npm run shipping:migrate`, and `npm run dev`. Java 21 or newer is required locally. Tests require a dedicated migrated test database through `SHIPPING_DATABASE_URL`; CI supplies a real PostgreSQL service.

## Kubernetes / production

Use a managed PostgreSQL instance with failover, backups/PITR and restore testing. Create existing Kubernetes Secrets containing `SHIPPING_DATABASE_URL` (runtime role with read-only location access and INSERT on shipment requests) and `SHIPPING_MIGRATION_DATABASE_URL` (schema owner). Set `shipping.databaseSecretName` and `shipping.migrationSecretName`; the Helm pre-install/pre-upgrade Job runs migrations before rollout. Verified TLS is required by the chart. For private CA deployments, mount the CA and configure `SHIPPING_DB_CA_FILE`. The service supports multiple replicas; budget ten connections per replica plus migrations against database capacity.

Grant runtime `USAGE ON SCHEMA shipping` and `SELECT ON ALL TABLES IN SCHEMA shipping`; set matching default privileges for the migration owner. Runtime credentials do not need DDL privileges. RabbitMQ consumption requires INSERT on `shipping.shipment_requests`; location tables remain read-only. Compose is a local single-server configuration, not a production HA database.

## HTTP API

- `GET /api/shipping/countries`: country list and city counts.
- `GET /api/shipping/cities?country=IN&q=Hyderabad`: prefix search, 2–80 characters, at most 30 results.
- `POST /api/shipping/quote`: `{cityId, recipient, line1, postalCode}`. City coordinates and price come from the server; client prices are ignored.
- `GET /api/shipping/ready`: database/seed readiness.

The gateway stores the selected address and quote in the user's session, includes shipping in Razorpay's amount, requires a quote less than 24 hours old, and locks destination changes once payment begins. Orders retain their original destination and shipping price. Address contents never enter metrics or trace attributes.

The gateway still uses its existing single-writer JSON order ledger. Converting shipping to PostgreSQL does not make that ledger horizontally scalable; migrating orders/inventory and payment reservations to transactional storage remains a separate platform requirement.

## Java / Gradle commands

From `services/shipping-service/`:

```sh
./gradlew test bootJar
java -jar build/libs/shipping-service.jar --migrate
java -jar build/libs/shipping-service.jar
```

Direct Java commands read exported environment variables, not `.env`; the root npm migration/development commands load `.env` for you. The runnable JAR includes the compressed data snapshot and SQL migrations. Migration checksums and seed IDs are compatible with the previous Node implementation, so existing PostgreSQL databases are retained. Runtime uses a restricted database role; `--migrate` uses the separate owner URL.

Compose builds `robotshop-shipping:local` using a separate multi-stage Java Dockerfile. Helm configures `shipping.image` separately from the Node application image. Java containers have a writable `/tmp` volume for Tomcat and a read-only root filesystem. Prometheus metrics remain at `/metrics` using standard Micrometer names; HTTP health remains `/health`, with database readiness at `/api/shipping/ready`. Set `SHIPPING_TRACING_ENABLED=true` and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to enable OpenTelemetry export; the dev launcher, Compose and Helm wire this automatically.

Gradle dependency locking and a verified Wrapper distribution checksum provide repeatable builds. Run `./gradlew test bootJar --write-locks` after reviewing dependency upgrades. CI uses Java 21, runs Java unit tests and the full HTTP checkout tests against PostgreSQL, and builds both Node and Java images.

## Redis and RabbitMQ

Compose enables Redis location caching and RabbitMQ paid-order processing. Set `REDIS_PASSWORD`, `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in `.env` before startup. Use URL-safe credentials in Compose or percent-encode credentials in connection URLs. For local Node/Java startup, set `CACHE_ENABLED=true`, `MESSAGING_ENABLED=true`, the Redis/RabbitMQ host credentials, and the gateway's `RABBITMQ_URL`. Do not use the RabbitMQ guest account remotely.

Redis stores only public location results, never addresses, carts, payment data or stock. Country results expire after six hours and searches after ten minutes. Keys include the dataset hash, so a new seed cannot reuse obsolete entries. Redis failure falls back to PostgreSQL with short connection/command timeouts. Compose limits cache memory and uses LRU eviction; Redis data is disposable.

The gateway records a pending `order.paid` event in the same saved ledger update as payment confirmation. A background publisher retries until RabbitMQ confirms a persistent, mandatory publication. The durable quorum queue `robotshop.shipping.orders` routes events to Java shipping. The consumer inserts into `shipping.shipment_requests` before acknowledgement; unique order/event IDs make redelivery harmless. Processing failures retry five times, then route to `robotshop.shipping.failed` through `robotshop.orders.dlx`. Monitor and replay that queue after correcting the cause; no automatic replay loop is enabled. Shipment status `requested` means queued for fulfilment, not dispatched to a carrier.

Migration 002 creates the shipment table. The local Compose migration grants INSERT to `shipping_app`; external databases require a DBA to grant INSERT and SELECT on that table to the runtime role. Apply the migration before enabling the consumer. Existing orders paid before the outbox feature are not automatically replayed. Broker downtime does not reverse a confirmed payment: its pending event stays in the ledger and is retried after recovery. The ledger remains single-writer JSON, with its existing persistence limitations.

RabbitMQ message payloads and the shipment table contain delivery addresses: restrict broker/database access and apply your retention policy. Logs and metric labels omit payloads. Metrics include `robotshop_location_cache_total{result="hit|miss|error"}` and `robotshop_shipping_events_total{result="accepted|duplicate|invalid"}`. RabbitMQ queue depth, dead-letter depth and oldest pending gateway event also need operational monitoring.

Kubernetes uses managed Redis and RabbitMQ via `integrations.secretName` with TLS enabled. The existing Secret must contain `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`, and `RABBITMQ_URL` (an `amqps://` URL). Provision broker permissions for the `robotshop.*` exchanges/queues. Compose provides single-node development services, not a highly available production broker/cache cluster.
