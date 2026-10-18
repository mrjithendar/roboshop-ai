# Product ingestion

Port 4101 serves `GET /api/products` from MongoDB. Configure `MONGODB_URL` and optional
`MONGODB_DATABASE` (default `robotshop`). `GET /api/catalogue/ready` checks MongoDB.

At startup, the eleven legacy products in `products.json` are validated and inserted
only if their SKU is missing. Existing admin edits and archived products survive
restart. This database is the catalogue used by storefront, recommendations and AI.

`npm run ingest -- /path/to/products.json` validates/replaces the checked-in seed
file. Restarting ingestion inserts new SKUs from it; it does **not** overwrite products
already in MongoDB. Use the authorized admin API/panel to change existing products.
There is no runtime `CATALOGUE_FILE` override or automatic external synchronization.

Images remain deployed static assets under the legacy image directory. New SKUs use
the placeholder until a matching image is packaged. Products are archived, not hard
deleted, so existing carts and payment snapshots remain interpretable.
