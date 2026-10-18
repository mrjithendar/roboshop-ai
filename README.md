# RobotShop AI

A working local modernization of the Robot Shop demo: responsive storefront,
catalogue-grounded shopping assistant, recommendations, persistent demo checkout,
and service observability. The original application in `legacy/original-robotshop/`
is unchanged.

## Start locally

Requires Node.js 24 or newer. No npm dependencies or installation step is required.

```sh
npm run dev
```

Open **http://localhost:3000**. The launcher starts five services and Ctrl+C stops
all of them. Data is stored in `.data/store.json`, which is excluded from Git.
The shop contains fictional robots; checkout records a demo order and never charges
money, takes payment details, or arranges delivery.

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

```sh
docker compose config --quiet
docker compose up --build -d
```

| Endpoint | Purpose |
| --- | --- |
| http://localhost:3000 | Storefront, shopping assistant, system status |
| http://localhost:3000/metrics | Gateway Prometheus metrics |
| http://localhost:9090 | Prometheus queries and alert rules |
| http://localhost:16686 | Jaeger distributed traces |
| http://localhost:3000/api/ready | Dependency readiness |

Compose runs the five application services, an OpenTelemetry collector, Jaeger,
and Prometheus. Published ports bind to loopback. The app image runs as a non-root
user with a read-only root filesystem; only the gateway's data volume is writable.
Stop with `docker compose down`. Do not add `--volumes` unless you intend to delete
saved demo data. Jaeger uses ephemeral in-memory trace storage; Prometheus and shop
data use named volumes.

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
| `frontend/` | Responsive HTML/CSS/JS storefront; no AngularJS or third-party browser scripts |
| `services/ai-gateway/` | Public API, static assets, validation, rate limits, sessions, demo carts/orders |
| `services/shopping-agent/` | Keyword retrieval, optional model synthesis, visible fallback |
| `services/recommendation-service/` | Budget/category/stock-aware ranking with reasons |
| `services/product-ingestion/` | Validated catalogue snapshot, importer, read-only catalogue API |
| `services/sre-copilot/` | Live health probes and deterministic read-only runbook suggestions |
| `services/mcp-server/` | Stdio MCP adapter with two read-only tools |
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
[Dependabot](.github/dependabot.yml) checks the active npm, Docker, Docker Compose,
GitHub Actions and `/vpc` Terraform paths every Monday at 09:00 Asia/Kolkata. Minor
and patch changes are grouped per ecosystem; major changes remain separate. The
legacy snapshot and its launch file are excluded. The active npm package currently
has no third-party dependencies. Existing Terraform providers have no explicit
version constraints, limiting useful provider-update PRs until constraints/lockfiles
are added as a separate infrastructure change.

## Deployment boundaries

This is a single-instance demo platform, not a production commerce deployment.
The JSON ledger has one writer, bounded session/order capacity, and no database
transactions across replicas. Sessions expire after seven days. There is no account
login, real payment/shipping flow, vector database, personalized model, or automated
SRE remediation. Product ingestion is a validated batch import, not a scheduled
synchronization pipeline. MCP search uses the imported stock snapshot, while the
storefront also subtracts the demo order ledger.

Before exposing it beyond a trusted local/demo environment, add authentication,
operator authorization, TLS, a transactional database, durable telemetry storage,
and deployment-specific secret/network policies. No cloud resources were deployed.
See [architecture](docs/architecture/README.md), [decisions](docs/decisions/0001-local-platform.md),
and [demo scenarios](docs/demo-scenarios/README.md).

## Verified during implementation

Local HTTP/integration tests, deterministic evaluations, and Helm lint/render passed.
The storefront rendered in Chrome at desktop and 390px mobile widths; catalogue search,
assistant-to-bag interaction, bag persistence and demo checkout were verified. Docker Compose was unavailable on the workstation, so the container
stack and real Prometheus/Jaeger/Langfuse ingestion have not been runtime-verified.
The model adapter was tested using a mock; no live model call was made.
