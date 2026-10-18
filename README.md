# RobotShop AI

A working local modernization of the Robot Shop demo: responsive storefront,
catalogue-grounded shopping assistant, recommendations, Razorpay checkout,
and service observability. The original application in `legacy/original-robotshop/`
is unchanged.

## Start locally

Requires Node.js 24+, Python 3.11+ (containers use 3.12), Java 21+, PostgreSQL, and MongoDB 8. Configure database connection URLs in `.env` as described in [shipping setup](services/shipping-service/README.md).

```sh
npm ci
npm run shipping:build
npm run dev
```

Open **http://localhost:3000**. The launcher starts seven services and Ctrl+C stops
all of them. Accounts, login sessions, editable products and store settings are stored in MongoDB. Carts/orders remain in `.data/store.json`, which is excluded from Git.
The catalogue still contains fictional robots. The old demo-order endpoint is disabled.
Checkout requires login and uses Razorpay and can collect real money once configured with live merchant
credentials. Payment controls remain disabled until configuration is complete. Shipping includes destination selection and distance pricing; carrier fulfilment is not integrated. See [payment setup](services/payment-service/README.md).

## Optional AI

Copy `.env.example` to `.env`, set `OPENAI_API_KEY` and an `OPENAI_MODEL` available
to your account, then restart. Do not put credentials in frontend code or Git.
The assistant uses the OpenAI Responses API, with storage disabled, and receives
only the current question and matching catalogue evidence. There is no multi-turn
memory. Requests to the model send that question and evidence to OpenAI.

With no credentials, it explicitly uses deterministic catalogue search. If a model
request fails or times out, the same fallback is labeled in the interface. Product
cards always use catalogue data; model prose can still be inaccurate. The assistant
has no checkout, shell, payment, or infrastructure tools.

For Docker/Helm, also set `ASSISTANT_AI_ENABLED=true` / `aiEnabled: true` so the UI
reports the configured mode. The agent still checks its actual credentials.

## Containers and observability

For a fresh installation, run `python3 generate-secrets.py` to create a private `.env` containing all required passwords and the internal payment token. RabbitMQ defaults to username `robotshop`. The generator refuses to overwrite existing files. See [Compose secrets setup](docs/deployment/compose-secrets.md) for AWS Secrets Manager commands and existing installations.

```sh
docker compose config --quiet
./build-images.sh
docker compose up -d
```

| Endpoint | Purpose |
| --- | --- |
| http://localhost:3000 | Storefront, shopping assistant, system status |
| Internal `ai-gateway:3000/metrics` | Gateway Prometheus metrics (private in Compose) |
| http://localhost:9090 | Prometheus queries and alert rules |
| http://localhost:16686 | Jaeger distributed traces |
| http://localhost:3000/api/ready | Dependency readiness |

Compose runs seven application services, PostgreSQL, MongoDB, Redis, RabbitMQ, NGINX, an OpenTelemetry collector, Jaeger, and Prometheus. Published ports bind to loopback. The app image runs as a non-root
user with a read-only root filesystem; only the gateway's data volume is writable.
Stop with `docker compose down`. Do not add `--volumes` unless you intend to delete
saved application and database data. Jaeger uses ephemeral in-memory trace storage; Prometheus and shop
data, PostgreSQL, MongoDB and RabbitMQ use named volumes.

For local Node services to export to the Compose collector, set
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces` in `.env`.
Langfuse is optional; see [its setup guide](observability/langfuse/README.md).

The original stack is available separately:

```sh
docker compose -f docker-compose.legacy.yml up --build -d
```

It retains its old dependencies and port 8080. The new platform imports its product
catalogue and image assets; it does not connect to its account, cart, shipping,
rating, or payment services.

## Project map

| Path | Implementation |
| --- | --- |
| `services/frontend/` | Strict TypeScript storefront; compiled assets served by NGINX, with Razorpay checkout loaded on demand |
| `services/nginx/` | Edge server, split configuration, frontend image build and Compose deployment |
| `services/redis/` | Location cache configuration and Compose deployment |
| `services/rabbitmq/` | Order-event broker configuration and Compose deployment |
| `services/postgres/` | PostgreSQL deployment and least-privilege shipping role bootstrap |
| `services/shipping-service/` | Java/Gradle shipping quotes, SQL locations and shipment event consumer |
| `services/ai-gateway/` | Public API, static assets, validation, rate limits, sessions, carts, pending/paid orders |
| `services/shopping-agent/` | Keyword retrieval, optional model synthesis, visible fallback |
| `services/recommendation-service/` | Budget/category/stock-aware ranking with reasons |
| `services/product-ingestion/` | MongoDB catalogue API and insert-only legacy product seed |
| `services/mongodb/` | Accounts, login sessions, products/settings database and Compose deployment |
| `services/payment-service/` | Razorpay orders, signature verification, captured-payment validation |
| `services/sre-copilot/` | Live health probes and deterministic read-only runbook suggestions |
| `services/mcp-server/` | Python MCP adapter with 15 shopping, diagnostics and role-protected admin tools |
| `services/shared/` | HTTP, trace propagation, metrics, catalogue validation and ranking |
| `observability/` | Collector, Prometheus alerts, optional Langfuse configuration |
| `infrastructure/helm/robotshop-ai/` | Demo Kubernetes chart with a single gateway and persistent volume |
| `infrastructure/argocd/` | Manual-sync example requiring your repository and image values |
| `vpc/` | Existing Terraform, currently at the repository root; untouched by modernization |
| `tests/`, `evaluations/` | Automated tests and deterministic retrieval/security cases |

## Checks

```sh
npm test
npm run evaluate
helm lint infrastructure/helm/robotshop-ai
helm template robotshop infrastructure/helm/robotshop-ai
```

Tests cover catalogue validation, budget/stock filtering, model contract and failure
fallback with a mock, session isolation, persistent stock, authoritative totals,
idempotent checkout, HTTP validation, trace propagation, metrics, MCP tools, and
dependency failure. Integration tests require permission to listen on localhost.
Evaluations run offline; they are not live-model safety or quality certifications.

GitHub Actions runs tests, evaluations, Compose validation, and an image build.
[Dependabot](.github/dependabot.yml) checks the active npm, Gradle, Docker, Docker Compose,
GitHub Actions and `/vpc` Terraform paths every Monday at 09:00 Asia/Kolkata. Minor
and patch changes are grouped per ecosystem; major changes remain separate. The
legacy snapshot and its launch file are excluded. The active npm package currently
uses `amqplib` for RabbitMQ; Java shipping dependencies are managed by Gradle. Existing Terraform providers have no explicit
version constraints, limiting useful provider-update PRs until constraints/lockfiles
are added as a separate infrastructure change.

## Deployment boundaries

This is a single-instance platform, not a complete production commerce deployment.
The JSON ledger has one writer, bounded session/order capacity, and no database
transactions across replicas. Sessions expire after seven days. There is no account
login, shipping flow, vector database, personalized model, or automated
SRE remediation. Product ingestion is a validated batch import, not a scheduled
synchronization pipeline. MCP search uses the imported stock snapshot, while the
storefront also subtracts the order ledger.

Before exposing it beyond a trusted local/demo environment, add authentication,
operator authorization, TLS, a transactional database, durable telemetry storage,
and deployment-specific secret/network policies. No cloud resources were deployed.
See [architecture](docs/architecture/README.md), [decisions](docs/decisions/0001-local-platform.md),
and [demo scenarios](docs/demo-scenarios/README.md).

## Verified during implementation

Local HTTP/integration tests, deterministic evaluations, and Helm lint/render passed.
The storefront rendered in Chrome at desktop and 390px mobile widths; catalogue search,
assistant-to-bag interaction and bag persistence were verified. Razorpay flow tests use a
mock provider; no real payment was submitted. Docker Compose was unavailable on the workstation, so the container
stack and real Prometheus/Jaeger/Langfuse ingestion have not been runtime-verified.
The model adapter was tested using a mock; no live model call was made.

## Razorpay live-payment configuration

The payment service replaces the dummy behavior of the legacy payment component;
the original snapshot stays unchanged. It runs on port 4105 with the same Node runtime
as the modern services. The gateway is the only public application entry point.

Set these values in your ignored `.env` (never in frontend code or chat):

```dotenv
PAYMENT_MODE=live
PUBLIC_ORIGIN=https://your-store.example
RAZORPAY_KEY_ID=rzp_live_YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
PAYMENT_SERVICE_TOKEN=YOUR_RANDOM_INTERNAL_TOKEN
```

Configure a Razorpay `payment.captured` webhook to
`https://your-store.example/api/payments/webhook`, enable automatic capture in the
merchant dashboard, and restart the services. Keep the same webhook secret on both
sides. Existing catalogue prices remain EUR; the merchant account must support EUR
payments. This change does not convert prices to INR or activate a merchant account.
Use `PAYMENT_MODE=test` with test keys for sandbox verification before enabling live
keys. Live keys require an HTTPS PUBLIC_ORIGIN. No live credentials were configured
or real payment tested during implementation.

Pending checkouts reserve stock and lock cart changes. Dismissal does not claim payment
failure or clear the bag: resume the same order or check payment status. A signed webhook
or status reconciliation can finish an order if the browser callback is lost. Orders are
marked paid only after the provider reports a matching captured, unrefunded payment.
Reservations are not automatically released because a provider checkout might still be
payable. Abandoned or ambiguous creation attempts require merchant reconciliation;
automated cancellation, refunds, disputes, and fulfilment are not implemented.

## PostgreSQL shipping

Shipping now requires a dedicated PostgreSQL server. Run `npm ci` and configure database credentials before `npm run dev`. Shipping initializes its SQL schema and location data during startup. Compose includes PostgreSQL and persistent storage; Helm uses an external TLS-enabled database. See [shipping setup and data coverage](services/shipping-service/README.md). Checkout now requires a delivery address and shipping quote, and payment totals include shipping.

Redis caching and RabbitMQ order events are enabled in Compose. Redis accelerates location lookups; RabbitMQ delivers confirmed orders to Java shipping, which records shipment requests in PostgreSQL. Run migrations before starting the updated stack. See [cache and messaging configuration](services/shipping-service/README.md#redis-and-rabbitmq). RabbitMQ management is available locally at http://localhost:15672 with your configured credentials. Stop the stack with `docker compose down`; retain volumes to preserve PostgreSQL and RabbitMQ data.

## NGINX entry point

Compose now serves the storefront through NGINX at **http://localhost:3000** and proxies `/api/*` to the private AI gateway. Configuration is split into commented files for routing, caching, headers, compression, logging and optional HTTPS. See the [NGINX configuration guide](services/nginx/README.md) for the file map, startup commands and TLS setup. Native development still uses the gateway directly.

## Service layout and frontend build

All application and supporting-service sources now live under `services/`. Root
`docker-compose.yml` orchestrates the stack and extends the deployment definitions
in `services/{nginx,redis,rabbitmq,postgres}/compose.yml`. Kubernetes orchestration
remains under `infrastructure/helm/`; monitoring configuration stays under
`observability/`.

The storefront source is `services/frontend/src/app.ts`. Run `npm ci`, then
`npm run frontend:build` to compile it into the ignored `services/frontend/dist/`
directory. `npm run frontend:typecheck` checks the strict TypeScript contracts.
`npm run dev`, `npm start`, and `npm test` build it automatically. Both Docker images
compile it in a build stage, so no host-generated assets are required.

The frontend is deployed as static assets in the NGINX service; it does not need an
additional Node process or network hop. Local development serves the same compiled
assets through the gateway. After changing frontend code, rebuild/restart your
chosen deployment. See the [frontend guide](services/frontend/README.md) and the
[architecture review](docs/architecture/2026-10-18-review.md) for boundaries,
verification results, and remaining production work.

Shipping performs schema migrations and location seeding within its own Java process
before accepting traffic. There is no separate migration service or Helm Job. For
an existing Compose deployment, `docker compose up -d --remove-orphans`
removes the retired migration container while retaining named database volumes.

## Login and administration

Use **Log in** to register or sign in. Login is required before checkout. Admins see
an **Admin panel** link (`/admin`) for managing products. The single super admin also
manages user roles, disabled accounts and public store configuration.

There are no default admin credentials. Configure MongoDB, supply `SUPERADMIN_EMAIL`
and `SUPERADMIN_PASSWORD` through your local environment, then run
`npm run admin:bootstrap` once. See the [complete setup and permissions guide](docs/architecture/identity-and-admin.md)
for native, Compose and Kubernetes setup. Keep passwords out of Git and chat.

## Service container images

Each application microservice owns `services/<service>/Dockerfile` and its own image.
Build from the repository root, for example:

```sh
docker build -f services/ai-gateway/Dockerfile -t robotshop-ai-gateway:local .
./build-images.sh
```

Run `./build-images.sh` before starting Compose. Compose uses the resulting images and contains no build directives. Java shipping and NGINX
retain their dedicated Dockerfiles. NGINX compiles and serves the TypeScript
frontend; backend images do not include frontend assets or other application services.
Redis, RabbitMQ, MongoDB and PostgreSQL use their official images and existing
service-specific Compose configuration.

The MCP server is a standalone stdio image: build with
`docker build -f services/mcp-server/Dockerfile -t robotshop-mcp-server:local .`
and run with `docker run --rm -i` plus internal service URL environment variables
and the appropriate Docker network. It does not expose an HTTP port.

## Python gateway, shopping agent and MCP

The gateway, shopping agent and MCP server run Python; payment, recommendations,
product ingestion and SRE remain Node, and shipping remains Java. Each has its own
Docker image. Install Python dependencies for native development:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r services/ai-gateway/requirements.txt -r services/shopping-agent/requirements.txt
export PYTHON="$PWD/.venv/bin/python"
npm run dev
```

`PYTHON` also selects the interpreter for `npm run mcp`, `admin:bootstrap`,
`test:python`, `evaluate` and HTTP integration tests. CI installs the same pinned
requirements. Container execution does not require a host Python environment.

New gateway endpoints: `GET /api/compare?skus=RED,RMC` compares 2–4 products;
`GET /api/recommendations/personalized` requires login and recommends available
products from the account cart's categories, excluding products already in it.
An empty cart falls back to general in-stock picks. The frontend continues using
its existing interface; these capabilities are exposed through the APIs and the
15 tools described in [MCP setup](services/mcp-server/README.md).

Existing MongoDB users, scrypt hashes and sessions, catalogue/settings documents,
and the JSON order/cart ledger remain compatible. Gateway replicas must stay at
one: a process lock protects the ledger, but it is not a distributed database.
Back up the ledger and MongoDB before deployment. The old Node auth/ledger modules
are retained only under `tests/fixtures/previous-gateway` for compatibility tests;
they are not shipped in production images.

## Customer records and distributed tracing

MongoDB now stores login timestamps, observed IP/browser metadata, recent login
activity, saved validated shipping addresses and replay-safe paid purchase history.
Customers can inspect their own records from the account dialog; the super admin
can inspect customer details in the users panel. See [customer data and access
rules](docs/architecture/customer-records.md).

OpenTelemetry covers HTTP services, MCP tool calls, downstream requests and the
RabbitMQ payment-to-shipping flow. Jaeger is available at `http://localhost:16686`
when the Compose stack is running. See [tracing coverage and configuration](observability/opentelemetry/README.md).

## Build all Docker images

From the repository root:

```sh
./build-images.sh
docker compose up -d
```

The script builds nine images: gateway, ingestion, recommendations, shopping agent,
SRE, payments, MCP, Java shipping and NGINX (which includes the frontend). MongoDB,
PostgreSQL, Redis, RabbitMQ and observability backends use their configured official
images; Compose pulls them when needed. MCP remains under the optional `tools` profile.

To use a custom registry prefix/tag, export the same values for both commands:

```sh
export IMAGE_PREFIX=registry.example.com/team/robotshop
export IMAGE_TAG=release-1
./build-images.sh
docker compose up -d
```

The script reads exported environment variables, not `.env`. Shell exports also
override Compose `.env` values, keeping build and runtime tags consistent. It does
not push images. `./build-images.sh --help` documents `--pull`, `--no-cache`,
`--platform` and `--dry-run`. It stops at the first failed build. Rebuild before
recreating services after code changes; `docker compose build` no longer builds
application images. The legacy Compose stack is unchanged.
