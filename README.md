# RobotShop AI

Repository scaffold for adding AI capabilities to the existing Robot Shop application.
The legacy source is preserved under `legacy/original-robotshop/`. AI services,
frontend, observability, deployment configuration, and evaluations are placeholders.

## Repository layout

```text
robotshop-ai/
├── legacy/original-robotshop/
├── services/
│   ├── ai-gateway/
│   ├── shopping-agent/
│   ├── recommendation-service/
│   ├── product-ingestion/
│   ├── sre-copilot/
│   └── mcp-server/
├── frontend/
├── infrastructure/
│   ├── terraform/vpc/
│   ├── helm/
│   └── argocd/
├── observability/
│   ├── opentelemetry/
│   ├── prometheus/
│   └── langfuse/
├── evaluations/
│   ├── rag/
│   ├── agents/
│   └── security/
├── tests/
├── docs/
│   ├── architecture/
│   ├── customer-requirements/
│   ├── decisions/
│   └── demo-scenarios/
├── docker-compose.yml
└── README.md
```

## Run the legacy baseline

Requires Docker with Docker Compose and access to container registries and build dependencies.
From this directory:

```sh
docker compose config --quiet
docker compose up --build -d
```

Open http://localhost:8080. Inspect with `docker compose ps` and
`docker compose logs -f`; stop with `docker compose down`.
The root Compose file adapts the original stack's build paths and supplies its
original image defaults (`REPO=robotshop`, `TAG=2.1.0`). Override these through
environment variables or a local `.env` file. This is the existing legacy demo;
its dependencies have not been upgraded or runtime-verified by this scaffold.

## Existing infrastructure

The original `vpc/` directory is now `infrastructure/terraform/vpc/`.
Its contents are unchanged, including its Jenkinsfile and environment configuration.
Review backend, account, variables, and CI working-directory references before deploying.

## Implementation scope

Each new directory includes a README describing its responsibility so it is tracked
by Git. No AI endpoints, model integrations, new UI, cloud resources, telemetry
pipelines, or evaluation suites have been implemented. Define contracts and acceptance
criteria in `docs/` before implementing those components.
