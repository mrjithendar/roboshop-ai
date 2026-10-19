Product imports, seed data and catalogue migrations live here. Normal application reads use [`catalogue-service`](../catalogue-service/README.md). The read endpoints below remain for older clients configured with `INGESTION_URL`.

# Product ingestion

Port 4101 serves `GET /api/products` from MongoDB. Configure `MONGODB_URL` and optional `MONGODB_DATABASE` (default `robotshop`). `GET /api/catalogue/ready` checks MongoDB.

Startup validates and inserts the 30 curated showcase products in `products.json` only when the SKU is absent. Existing administrator edits and archived products survive restart. Source prices retain their currency; `on-request` prices are unknown, with numeric zero only as a legacy schema sentinel. All curated products are display-only and cannot enter live checkout.

For an existing installation, explicitly run `node services/product-ingestion/migrate-catalogue.mjs --archive-legacy` with MongoDB configuration. It archives only unchanged revision-1 fictional seed records; it preserves admin edits and orders. See [migration, provenance and currency policy](../../docs/deployment/robotics-showcase.md).

`npm run ingest -- /path/to/products.json` validates/replaces the seed file. It does not update existing MongoDB rows. `CATALOGUE_FILE` is an optional operator/test fixture path. There is no public import endpoint or automatic external synchronization.

Products carry source links, specifications, compatibility, package caveats and image permission information. The curated seed uses the existing placeholder; no manufacturer photos are copied. The unique stored-slug index supports shareable detail URLs.

## Independent service build

Run `docker build -t robotshop-product-ingestion:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
