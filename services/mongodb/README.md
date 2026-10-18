# MongoDB accounts and catalogue

MongoDB persists `users`, `auth_sessions`, `auth_limits`, `products`, and `settings`.
Authentication and administration run inside the existing AI gateway; this adds a
database container, not another application microservice. Product-ingestion reads
and seeds the catalogue in this database.

`compose.yml` is extended by root Compose. Configure `MONGO_ROOT_PASSWORD` and
`MONGO_APP_PASSWORD` in the ignored `.env`, then run from the repository root:

```sh
./build-images.sh
docker compose up -d
```

Use long, randomly generated URL-safe passwords for local Compose because its app
URL interpolates the password. Only loopback port 27017 is published. A named
`mongo-data` volume retains accounts and catalogue edits. `10-app-user.js` runs only
on first initialization and creates an application user restricted to the `robotshop`
database. Changing `.env` does not rotate an existing database user's password.
Do not remove the volume to rotate credentials.

For native development set `MONGODB_URL` to your authenticated MongoDB URI and
`MONGODB_DATABASE=robotshop`. `npm run dev` passes these only to the gateway and
product-ingestion. Do not connect the new application to the legacy users database:
legacy plaintext password records are not imported or accepted.

For Kubernetes use an external MongoDB deployment and set `mongodb.secretName` to
an existing Secret containing `MONGODB_URL`, with verified TLS enabled in the URI.
Set `mongodb.database` if it differs from `robotshop`. Provision backups, restore
procedures, credential rotation and availability through your database platform.

See [identity and admin setup](../../docs/architecture/identity-and-admin.md) for
super-admin creation, roles, login behavior and API boundaries.
