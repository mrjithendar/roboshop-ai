# Catalogue service

Node.js service backed by the existing MongoDB `robotshop.products` collection, following the legacy RobotShop catalogue API. It does not create a second database or copy product records. Administrative product edits remain in the authenticated gateway; ingestion owns imports and migrations. This service exposes reads only, using the existing application Mongo credential.

| Route | Response |
|---|---|
| `GET /products` | Active products as an array (legacy shape) |
| `GET /product/:sku` | Product by SKU, or 404 |
| `GET /products/:category` | Products in a category |
| `GET /categories` | Sorted unique categories |
| `GET /search/:text` | Literal, case-insensitive name/description/category search; every word must match |
| `GET /api/products` | Modern `{products, checkoutCurrency, source}` response |
| `GET /api/catalogue/ready` | MongoDB readiness; 503 when unavailable |
| `GET /health`, `GET /metrics` | Process liveness and Prometheus metrics |

The gateway exposes `/api/catalogue/categories`, `/api/catalogue/product/:sku`, `/api/catalogue/category/:category`, and `/api/catalogue/search/:text`. The public URL is prefixed with `/roboshop`. Gateway product responses adjust stock for reservations and completed orders. The frontend's existing `/api/products` and product-detail/review routes remain unchanged.

Archived products are excluded. Out-of-stock products remain visible. Prices retain their currencies; `checkoutCurrency` is null for an empty or mixed-currency catalogue. Search is literal rather than MongoDB's legacy text-index stemming. Queries do not become Mongo operators or regular expressions. Reads are bounded by the shared 10,000-product limit; this is suitable for the current 20-product catalogue, not an unbounded catalogue search engine.

Configuration: `MONGODB_URL`, `MONGODB_DATABASE` (default `robotshop`), port 4108. Clients use `CATALOGUE_URL=http://catalogue-service:4108`. Native development defaults to localhost:4108; explicitly configured `INGESTION_URL` remains a compatibility fallback for older integrations. The old ingestion read route is retained for that transition; normal Minikube traffic uses this service.

## Build and deploy

```bash
bash build-images.sh
bash deploy-minikube.sh
```

The scripts build twelve application images, including `robotshop-catalogue-service:local`, and deploy eighteen workloads. Kubernetes uses `catalogue-service-minikube.yaml`. No data reset is required. Shared runtime provides request logs, trace propagation, OpenTelemetry export and metrics; SRE readiness checks use the Mongo-aware endpoint.

Examples after deployment:

```bash
curl https://jithendar.com/roboshop/api/catalogue/categories
curl https://jithendar.com/roboshop/api/catalogue/product/ATLAS-X1
curl https://jithendar.com/roboshop/api/catalogue/search/Atlas
```

## Independent service build

Run `docker build -t robotshop-catalogue-service:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
