# Catalogue service

Node.js service backed by the existing MongoDB `roboshop.products` collection, following the legacy RoboShop catalogue API. It does not create a second database or copy product records. Catalogue-service now owns product ingestion, seed data and explicit import/migration commands. Administrative product edits remain in the authenticated gateway. Its HTTP API exposes reads only, using the existing application Mongo credential.

| Route | Response |
|---|---|
| `GET /products` | Active products as an array (legacy shape) |
| `GET /product/:sku` | Product by SKU, or 404 |
| `GET /products/:category` | Products in a category |
| `GET /categories` | Sorted unique categories |
| `GET /search/:text` | Literal, case-insensitive name/description/category search; every word must match |
| `GET /api/recommendations` | Deterministic keyword recommendations with query, budget, category, exclude and limit filters |
| `GET /api/products` | Modern `{products, checkoutCurrency, source}` response |
| `GET /api/catalogue/ready` | MongoDB readiness; 503 when unavailable |
| `GET /health`, `GET /metrics` | Process liveness and Prometheus metrics |

The gateway exposes `/api/catalogue/categories`, `/api/catalogue/product/:sku`, `/api/catalogue/category/:category`, and `/api/catalogue/search/:text`. The public URL is prefixed with `/roboshop`. Gateway product responses adjust stock for reservations and completed orders. The frontend's existing `/api/products` and product-detail/review routes remain unchanged.

Archived products are excluded. Out-of-stock products remain visible. Prices retain their currencies; `checkoutCurrency` is null for an empty or mixed-currency catalogue. Search is literal rather than MongoDB's legacy text-index stemming. Queries do not become Mongo operators or regular expressions. Reads are bounded by the shared 10,000-product limit; this is suitable for the current 20-product catalogue, not an unbounded catalogue search engine.

Configuration: `MONGODB_URL`, `MONGODB_DATABASE` (default `roboshop`), port 4108. Clients use `CATALOGUE_URL=http://catalogue-service:4108`. Native development defaults to localhost:4108. `CATALOGUE_URL` is the only catalogue endpoint setting; the retired `INGESTION_URL` fallback has been removed.

## Build and deploy

```bash
bash scripts/images/build-push-ecr.sh catalogue-service
bash scripts/deploy/deploy-minikube.sh catalogue-service
```

The selected image is `roboshop-catalogue-service:local`; only this service needs rebuilding for the merge. Kubernetes uses `catalogue-service-minikube.yaml`. No data reset is required. Shared runtime provides request logs, trace propagation, OpenTelemetry export and metrics; SRE readiness checks use the Mongo-aware endpoint.

Examples after deployment:

```bash
curl https://jithendar.com/roboshop/api/catalogue/categories
curl https://jithendar.com/roboshop/api/catalogue/product/ATLAS-X1
curl https://jithendar.com/roboshop/api/catalogue/search/Atlas
```

## Independent service build

Run `docker build -t roboshop-catalogue-service:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).

## Product ingestion and startup

Before opening its HTTP listener, the service validates `CATALOGUE_FILE` (default:
service-owned `products.json`), ensures the slug index and inserts missing products
with `$setOnInsert` upserts keyed by SKU. Redeploys do not replace existing rows:
admin-edited prices, currencies, stock, revision numbers and archived flags remain.
No order, payment, reservation or user collection is changed. Validation/database
failures prevent startup; the connection is closed and Kubernetes can retry.

Deletion behavior is unchanged: deleting a configured seed SKU from MongoDB allows
it to be reinserted on a later startup. Archive the listing to retire it permanently,
or explicitly remove it from the configured seed file as well.

From this service directory:

```bash
npm run ingest -- /path/to/input-products.json   # validate/write the local seed file
npm run publish:catalogue                      # explicit insert-only Mongo publication
npm test
```

All previous ingestion data and utilities now live here, including reference
catalogues, guarded synthetic-data utilities, `migrate-catalogue.mjs`,
`refresh-showcase.mjs` and `lib/price-migration.mjs`. These migrations are not run at
startup. Python utilities use `requirements-tools.txt`; they are not new services.

## Upgrade an existing installation

The MongoDB collection and credentials are unchanged; no data migration/reset is
needed. Build and deploy catalogue-service using the commands above. Confirm it is
ready and the catalogue is visible before removing the retired workload:

```bash
kubectl --context=mk4 -n roboshop-ai delete deployment/product-ingestion service/product-ingestion --ignore-not-found
```

The deployment scripts do not prune old resources automatically. No adoption manifest, build workflow or runtime endpoint remains for the retired
service. Existing ECR images are not deleted by repository changes. Remove any old
Argo Application registration without cascading deletion before cleaning up its
Deployment/Service, so GitOps cannot recreate them.

## Recommendations (merged)

The same process serves `GET /api/recommendations` directly from MongoDB using
`lib/catalogue.mjs` ranking. There is no separate recommendation pod or HTTP call
back to catalogue-service. Query parameters and the response
`{products, strategy: "catalogue-keyword-ranking", personalized: false}` are unchanged.
Archived/out-of-stock products are excluded; currency-aware budgets, category/SKU
filters and limits remain. The gateway still filters reserved stock and handles
authenticated cart-based recommendations. Prices and order currencies are unchanged.

`RECOMMENDATION_URL` now points to `http://catalogue-service:4108`, just like
`CATALOGUE_URL`. The root deployment script patches both keys and restarts gateway
and SRE consumers; the GitHub workflow applies the updated shared ConfigMap.
`/ready` is a Mongo-backed alias for old recommendation health checks. A database
outage now affects catalogue reads and recommendations together; invalid recommendation
inputs affect only that request. Liveness remains independent of MongoDB.

After building/deploying catalogue-service and confirming both routes work, remove
the obsolete workload (no databases or secrets are deleted):

```bash
kubectl --context=mk4 -n roboshop-ai delete deployment/recommendation-service service/recommendation-service --ignore-not-found
```

The old ECR repository is retained for rollback. No CI workflow builds it anymore.
