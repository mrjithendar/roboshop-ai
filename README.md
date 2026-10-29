# RoboShop AI

> Initialization supports CentOS Stream 9/10, Amazon Linux 2023, Ubuntu 22.04/24.04 LTS,
> and macOS development/client tooling on x86_64/ARM64. See
> [the script matrix](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/operations/scripts.md) for operation-specific prerequisites.



Host setup and cluster tooling live in the [tools repository](https://github.com/mrjithendar/tools/tree/master/roboshop) (`roboshop/`); clone it beside this repository. Start a new host with `./init.sh --help` there, then choose `--profile dev`, `docker`,
`minikube` or `aws`. Use `--dry-run` first. See the
[operational script index](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/operations/scripts.md) for dependencies, canonical
commands, compatibility paths and first-time setup. Initialization never deploys
applications, creates credentials or starts a cluster.


## Repository layout

This repository holds the microservices (`services/`), tests (`tests/`, `evaluation*/`), GitHub runner setup (`runner/`) and the jithendar.com site (`sites/`). Cluster configuration, Argo CD, Minikube, observability, Terraform, operational docs and deployment scripts moved to [mrjithendar/tools](https://github.com/mrjithendar/tools/tree/master/roboshop) under `roboshop/`, cloned as `../tools`. Argo CD reads `services/*` manifests from this repository and everything else from tools.

RoboShop includes a TypeScript storefront, MongoDB catalogue and accounts, Redis cart service, Java shipping, Razorpay payment integration, Python AI gateway and shopping assistant, and distributed tracing. Application and supporting services live under `services/`.

## Cluster setup and application deployment

The supported infrastructure commands are (from `../tools/roboshop`):

```bash
cd ../tools/roboshop
./init.sh --profile minikube
./deploy-minikube.sh start
./deploy-traefik.sh
./patch-ssl.sh
./kubectl.sh get pods -A
```

`deploy-minikube.sh` manages the cluster only. `patch-ssl.sh` reuses an existing,
Ready site certificate; it does not install cert-manager or issue a certificate.
Set `KUBECONFIG` when using `kubectl.sh`, or provide its downloaded kubeconfig.
See [the command index](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/operations/scripts.md) for prerequisites.

Applications are deployed through the [Argo CD catalog](https://github.com/mrjithendar/tools/blob/master/roboshop/argocd/README.md).
Build/publish tooling remains available; update image references in Git and sync
through Argo CD. Imperative application deployment scripts and the old
Deploy-Minikube workflow have been removed. Existing manifests, Secrets and PVCs
are preserved; this repository cleanup does not change a live cluster.

## Native development

Requires Node.js 24+, Python 3.11+, Java/Gradle-compatible JDK, PostgreSQL and MongoDB. Configure connections in an ignored `.env` using `.env.example`; optional Redis/RabbitMQ integrations require their own running servers. See [shipping setup](services/shipping-service/README.md).

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r services/ai-gateway/requirements.txt -r services/user-service/requirements.txt -r services/moks/requirements.txt
export PYTHON="$PWD/.venv/bin/python"
npm run frontend:build && npm run shipping:build
```

There is no all-in-one local launcher any more: run the services you need (see each service's README), or use the Minikube deployment.

## Services

| Folder | Responsibility |
| --- | --- |
| `services/web` | Storefront (`frontend/`: TypeScript pages, cart, checkout, admin UI) and its NGINX (`nginx/`: asset routing, `/api` proxy, security headers), built and deployed as one `web` image |
| `services/ai-gateway` | Public API routing, authorization and order ledger |
| `services/user-service` | MongoDB accounts, sessions, profiles, MFA, email recovery and purchase history |
| `services/catalogue-service` | MongoDB catalogue reads and legacy-compatible product APIs |
| `services/catalogue-service` | Validated catalogue imports and publication |
| `services/cart-service` | Redis-backed carts |
| `services/shipping-service` | Java/Gradle, PostgreSQL locations, quotes and shipment requests |
| `services/payment-service` | Razorpay orders and captured-payment verification |
| `services/moks`, `services/catalogue-service` | Shopping assistance and recommendations |
| `services/mcp-server` | Private MCP server: catalogue search, comparison and the signed-in user's cart for AI clients |
| `services/mongodb` | Product catalogue data (`catalog.js`) imported into MongoDB; MongoDB itself is deployed from the tools repo |
| `services/postgres`, `services/redis`, `services/rabbitmq` | Data and messaging |

Each workload owns a `*-minikube.yaml`. Each application has its own Dockerfile. Metrics, logging and tracing configuration lives in the tools repo; see [observability](https://github.com/mrjithendar/tools/blob/master/roboshop/observability/README.md). `legacy/original-roboshop/` retains reference application source.

## Accounts, products and payments

Login is required for checkout. Customers shop, admins manage products, and the single super admin manages roles and store settings. There is **no default administrator password**. Follow the [bootstrap and permissions guide](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/architecture/identity-and-admin.md).

The merchant catalogue contains twenty robots; product images are labelled concept renders. Synthetic test profiles/reviews remain separate from authentic customer accounts and ratings. See [catalogue and review operations](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/deployment/robotics-showcase.md).

Payments remain unavailable until Razorpay credentials are configured. Minikube defaults to test mode. Live payments require deliberate merchant configuration, supported currency and HTTPS. The webhook path for this deployment is `/roboshop/api/payments/webhook`. See [payment setup](services/payment-service/README.md). Carrier fulfilment, refunds and disputes are not automated.

## AI and observability

No LLM is enabled by default. The super admin can test and activate Amazon Bedrock or an approved Ollama endpoint under **Admin → AI / LLM configuration**. See [provider setup](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/deployment/llm-providers.md).

Application metrics are private `/metrics` endpoints. Configure scrape targets in `observability/prometheus/values.yaml`; see [Prometheus](https://github.com/mrjithendar/tools/blob/master/roboshop/observability/prometheus/README.md). Traces go through the OpenTelemetry collector to Jaeger. Jaeger storage is ephemeral in this sandbox.

## Verification and limits

```bash
npm run frontend:typecheck
npm run frontend:build
npm test
```

Full tests require the documented language dependencies and local integration services; see [test instructions](tests/README.md). Per-service CI builds/pushes images to ECR; see [ECR setup](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/deployment/ecr-ci.md).

The gateway’s durable JSON order ledger remains single-writer: keep one gateway replica and back up its volume alongside MongoDB and PostgreSQL. This Minikube configuration is a development sandbox, not a highly available production deployment.

## Service ownership

Services build from their own directories and own their dependency manifests, assets and service-specific tooling. For example: `docker build -t roboshop-web:local services/web`. Root scripts coordinate the platform. See [service boundaries and repository extraction](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/architecture/service-repositories.md) for local tests, service-owned libraries and the future repository split.

### Moks — An AI agent for everyone.

The combined Python [Moks service](services/moks/README.md) supplies the
assistant on every storefront page and supports embedding on other websites.
It builds as `roboshop-moks:local`. Scale `deployment/moks` to zero to hide
it without disabling the storefront. See its README for embedding and configuration.

### Deploy ECR images from GitHub Actions

Run the per-service CI workflows first, then **Actions → Deploy-Minikube → Run
workflow** on the default branch. Deployment uses `:latest` from each ECR repository, always pulls it, and restarts
each application to pick up updates. It updates
applications in dependency order, and finishes with catalogue publication
and ingress/TLS. It does not build or load local images.

Runner requirements:

- A Linux self-hosted runner with `self-hosted` and `linux` labels, access to the
  intended cluster, AWS CLI, kubectl, Python/PyYAML and OpenSSL.
- `AWS_REGION` set to the ECR region (`us-east-1` for the current Terraform stack).
  Deployment uses runner AWS credentials and the registry configured in the YAML.
  The identity needs ECR authorization-token and image-pull permissions.
- Traefik, cert-manager and the Let's Encrypt issuer already installed.
- The runner uses `$HOME/.kube/config`. Set `MINIKUBE_KUBECONFIG` to override it
  with an existing absolute path. Credentials remain on the runner.

Choose the actual kubeconfig context, such as `mk4`. The namespace, databases,
application secrets (including SES SMTP credentials) must already exist. Runs are manual and
serialized. A failed rollout stops later steps; earlier service updates remain.
Existing data and account credentials are preserved. Finder remains optional.

Every deployment refreshes the ECR pull secret. Tokens expire after 12 hours;
new pod starts may require a refresh. Rerun the workflow to refresh credentials. See [ECR deployment](https://github.com/mrjithendar/tools/blob/master/roboshop/docs/deployment/ecr-ci.md#deploy-the-newest-ecr-images-to-minikube).

If a run stays **Queued**, check the runner labels and online status. For preflight
failures, check `aws sts get-caller-identity`, `kubectl --context=mk4 get nodes`
and `python3 -c 'import yaml'` as the runner user.

Build and push one service using its **Actions → service image → Run workflow** entry.
Omit `--service` to build every application image. Image publishing is separate from Argo CD deployment.

Images are built and pushed to ECR by each service's CI workflow (`.github/workflows/ci-<service>.yml`, which calls `publish-ecr.yml`) on pushes to `master`; then update
the application's image reference in Git and sync it through Argo CD.

### Kafka analytics stream

Order events now have a separate Kafka subscription alongside RabbitMQ shipping.
See [Kafka setup](services/kafka-bridge/README.md) for deployment, event topics, replay,
resource sizing and development-only security limits. Build/deploy `kafka-bridge`
and `ai-gateway` to enable the integration; no checkout dependency on Kafka is added.

### Create missing Minikube secrets

From `../tools/roboshop`, use `./create-secrets.sh --context mk4` to preview, then add `--apply` to create missing RoboShop, monitoring and WordPress credentials. Optional `--all` includes JFrog; `--ecr` refreshes image-pull tokens using existing AWS authentication. Existing credentials are preserved. See [secret setup and recovery safeguards](https://github.com/mrjithendar/tools/blob/master/roboshop/scripts/setup/SECRETS.md).

## License

Copyright (c) 2026 Jithendar Dharmapuri. All rights reserved. This is proprietary software; no use, copying, modification or distribution is permitted without written permission. See [LICENSE](LICENSE).
