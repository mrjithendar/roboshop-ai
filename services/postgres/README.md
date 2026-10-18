# PostgreSQL shipping database

`compose.yml` owns the PostgreSQL service. `10-shipping-role.sh` runs only when a new
data volume is initialized and creates the restricted `shipping_app` role. The root
Compose file owns the `shipping-postgres` named volume and sequences the Java
migration job before shipping starts.

From the repository root, configure `SHIPPING_DB_PASSWORD` and
`SHIPPING_APP_PASSWORD` in `.env`, then run `docker compose up -d --build`. Changing
an environment password does not rotate credentials in an existing database;
perform an explicit database role rotation. Never delete the volume to rotate keys.

Java migrations and the worldwide location dataset live in `../shipping-service/`.
Runtime needs SELECT on shipping tables and INSERT on `shipping.shipment_requests`;
schema migrations use separate owner credentials. PostgreSQL is published on
localhost:5432 only. Local Compose disables database TLS; production Helm requires
an external TLS PostgreSQL endpoint and separate runtime/migration Secrets.

Compose currently constructs database and AMQP URLs from environment values.
Use long randomly generated URL-safe credentials (for example hexadecimal) for
this local stack. External connection URLs must percent-encode reserved characters.
See `../../infrastructure/helm/README.md` for deployment responsibilities.
