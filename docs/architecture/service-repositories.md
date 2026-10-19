# Service ownership and future repository split

Each application under `services/<name>/` owns its runtime source, Dockerfile, `.dockerignore`, dependency manifest/lockfile, and Minikube manifest. Node services have independent `package.json` and `package-lock.json`; Python services retain pinned `requirements.txt`; shipping retains its Gradle wrapper/build. No Docker build copies source from a sibling folder or from the platform root.

## Build one service

```bash
cd services/frontend
npm ci
npm test
# From this directory:
docker build -t robotshop-frontend:local .
```

For a Node backend, run `npm ci` and `npm start` inside its folder. For Python, create a virtual environment there, install `requirements.txt`, and run `python server.py`. Configure service URLs and credentials in the environment. Services communicate through HTTP, MongoDB, Redis and RabbitMQ; independent source does not remove those runtime dependencies.

The root `build-images.sh` builds each service with its own directory as Docker context. ECR CI uses the same contexts. Image names, ports and in-container operational entrypoint paths remain stable, so existing Minikube deployment scripts continue working.

## Service-owned libraries

Each service owns its `lib/` directory. Edit and test those files in that service; there is no central library folder, synchronization script or runtime dependency on a sibling checkout. Similar implementations can evolve independently. If an API contract or security fix applies to several services, update and test each affected implementation explicitly.

## What lives where

- Frontend: TypeScript, HTML/CSS, product/legacy images, build tool, dependencies and UI unit tests. Original legacy-image source is retained as an archive; active builds use `frontend/images/`.
- Catalogue and payment: their unit tests are under each service's `tests/` directory.
- Shipping: GeoNames preparation tool is under `shipping-service/scripts/` alongside its data and Java build.
- Product ingestion: synthetic fixture seed/export tools are under `product-ingestion/scripts/`. Their country/territory fixture is `data/countries.json`, extracted from the existing GeoNames dataset (CC BY 4.0, https://www.geonames.org/). They preserve isolation and synthetic labels; they do not create authentic customers.
- Root `tests/`: cross-service integration, contracts, deployment and service-contract tests. These belong to the platform integration repository, not an individual service.
- Root `scripts/`: multi-service launcher, evaluator, Minikube seed orchestrator. Build/deploy shell scripts and cluster infrastructure stay at the platform level.

The gateway serves static assets only when `FRONTEND_DIST` is explicitly set for native development. The root launcher supplies it and keeps the existing root `.data` ledger path. Standalone gateway development defaults to its own `.data`; its container uses `/app/.data`. Existing containers continue to serve frontend content through NGINX.

## Extracting a repository

Copy the service directory, including `lib/`, its lockfile, assets and `.dockerignore`. Run its dependency install and tests from that directory, then build with `docker build .`. Configure external URLs/secrets; never copy `.env`, `.data`, caches or database volumes into Git.

Copy/adapt the relevant CI workflow to the new repository and change its build context to `.`. GitHub workflows must live under that repository's `.github/workflows/`; the current workflows remain at the monorepo root until extraction. Keep the platform repository for coordinated deployments and end-to-end checks. No repositories have been created or pushed by this restructuring.
