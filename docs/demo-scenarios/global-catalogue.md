# Catalogue, real photos, cart and global demo reviews

The catalogue contains 32 informational products, including TurtleBot3 Burger and Poppy Humanoid with original CC BY-SA photographs. Attribution and technical source links remain in the documentation area; there is no manufacturer shopping button. Existing 30 products retain category illustrations where no licensed photograph is supplied. Existing compatibility/application fields are now included in each specification table; new robot hardware values have source links. Product pages separate images, product facts and purchase options, with rating histograms and filters.

**Only actual sale products may enter the cart.** No real inventory or prices were invented. Informational products show a disabled Add to cart button with an explanation. Administrators must supply genuine sale products before real checkout can be demonstrated. Existing legacy sale products still work when their optional currency/type fields are missing.

## Deploy code and refresh curated content

On the Minikube host after syncing the changes:

```bash
bash build-images.sh
bash deploy-minikube.sh --load-images
kubectl -n robotshop-ai exec deployment/product-ingestion -- node services/product-ingestion/refresh-showcase.mjs
```

Builds eleven application images with `:local`, including `cart-service`. The refresh script inserts new catalogue records and updates informational fields only for untouched showcase records (`revision: 1`). It never changes sale prices, stock, or administrator-edited records. No data deletion is necessary. Compose alternative: `docker compose exec product-ingestion node services/product-ingestion/refresh-showcase.mjs`.

## Generate isolated demo data

Install the Python seeder dependencies (`pymongo`) in your virtual environment, then:

```bash
python scripts/export-demo.py
```

Creates ignored `artifacts/demo-global/` JSONL files: 10,000 synthetic profiles across exactly 200 country/territory codes from the existing GeoNames dataset, 30,000 clearly labeled synthetic reviews, simulated purchase records, and a manifest. Profile authentication is disabled. Each country/territory has 50 profiles. These are not real people, paid orders or verified purchases. The deterministic export does not connect to MongoDB or change the running app.

To seed an **isolated** MongoDB database, provide `DEMO_MONGODB_URL` through your secret manager (credentials must have permission on `robotshop_demo_global`), then:

```bash
APP_ENV=demo python scripts/seed-demo.py seed --database robotshop_demo_global --dataset global-v2
```

Rerunning the same dataset/configuration is idempotent. Demo seeding refuses production environments and the application's real database. Do not import these fixtures into the real users collection.

## Display demo reviews separately

The gateway accepts optional `DEMO_MONGODB_URL` plus `DEMO_REVIEWS_DATABASE=robotshop_demo_global`. Use a read-only MongoDB credential for the gateway, separate from the seeder's writer. In Minikube, configure optional Secret `robotshop-demo-reviews` with key `MONGODB_URL`, then restart only the gateway. Compose reads these settings from the environment. The `Synthetic demo reviews` selector reads this database; real reviews, moderation and purchase verification continue to use the normal application database. Without configuration, generated fixtures remain offline and the real reviews view stays unchanged.

See `services/cart-service/README.md` for Redis cart concurrency, recovery and the current single-writer gateway limitation.
