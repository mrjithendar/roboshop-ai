# Product ingestion

Port 4101, GET `/api/products`. `products.json` is a normalized snapshot of the eleven
products in the unchanged legacy Mongo seed. SKU uniqueness, safe identifiers, prices,
stock and category types are validated at startup and import.

```sh
npm run ingest -- /path/to/products.json
```

Restart product-ingestion after import. CATALOGUE_FILE can select another JSON file.
The importer validates before atomic replacement. It does not execute JavaScript,
fetch arbitrary URLs, or schedule synchronization. Images must already exist under
the legacy static image directory; the storefront falls back to its placeholder.
