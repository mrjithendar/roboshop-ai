# RobotShop AI

RobotShop includes a TypeScript storefront, MongoDB catalogue and accounts, Redis cart service, Java shipping, Razorpay payment integration, Python AI gateway and shopping assistant, and distributed tracing. Application and supporting services live under `services/`.

## Build and deploy to Minikube

On the Minikube host, from this directory:

```bash
bash build-images.sh
bash deploy-minikube.sh
```

The build script removes the previous application `:local` tags and rebuilds all twelve images without cache. The deployment script loads them into Minikube, applies all eighteen workloads in dependency order, restarts application pods, and checks readiness. Infrastructure uses official upstream images. These commands preserve existing database volumes and credentials.

Open **https://jithendar.com/roboshop/**. Traefik routes this path to NGINX, which proxies static pages to the frontend and API requests to the gateway. TLS is provided by cert-manager. WordPress and monitoring have separate routes.

For a fresh host, follow [cluster installation](minikube/README.md), then the [application deployment guide](minikube/robotshop/README.md) for ingress, certificates, secrets, remote registry deployment and troubleshooting. Docker Compose is no longer supported; its manifests and helper tools have been removed.

```bash
# Inspect a deployment
kubectl -n robotshop-ai get pods,pvc,ingress
kubectl -n robotshop-ai logs deployment/frontend --tail=100
kubectl -n robotshop-ai logs deployment/ai-gateway --tail=100

# Render and validate YAML without changing the cluster
bash deploy-minikube.sh --render-only /tmp/robotshop-manifests
python3 tests/minikube-manifests.test.py
```

First installation generates `robotshop-secrets`. Existing credentials are reused. Do not delete this Secret or the PVCs to resolve startup problems. The scripts do not automatically enable live payments, create an administrator or configure an LLM.

## Native development

Requires Node.js 24+, Python 3.11+, Java/Gradle-compatible JDK, PostgreSQL and MongoDB. Configure connections in an ignored `.env` using `.env.example`; optional Redis/RabbitMQ integrations require their own running servers. See [shipping setup](services/shipping-service/README.md).

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r services/ai-gateway/requirements.txt -r services/user-service/requirements.txt -r services/shopping-agent/requirements.txt
export PYTHON="$PWD/.venv/bin/python"
npm run dev
```

Open **http://localhost:3000**. Ctrl+C stops the launcher’s child processes. `npm run dev` builds the frontend and shipping application first. `python3 generate-secrets.py` can generate fresh native-development credentials; it does not provision database accounts or replace Minikube’s secret initialization.

## Services

| Folder | Responsibility |
| --- | --- |
| `services/frontend` | TypeScript storefront, product pages, cart and admin UI |
| `services/nginx` | Edge proxy, asset routing and security headers |
| `services/ai-gateway` | Public API routing, authorization and order ledger |
| `services/user-service` | MongoDB accounts, sessions, profiles, MFA, email recovery and purchase history |
| `services/catalogue-service` | MongoDB catalogue reads and legacy-compatible product APIs |
| `services/product-ingestion` | Validated catalogue imports and publication |
| `services/cart-service` | Redis-backed carts |
| `services/shipping-service` | Java/Gradle, PostgreSQL locations, quotes and shipment requests |
| `services/payment-service` | Razorpay orders and captured-payment verification |
| `services/shopping-agent`, `services/recommendation-service` | Shopping assistance and recommendations |
| `services/sre-copilot`, `services/mcp-server` | Diagnostics and MCP tools |
| `services/mongodb`, `services/postgres`, `services/redis`, `services/rabbitmq` | Data and messaging |
| `services/otel-collector`, `services/jaeger` | Distributed traces |

Each workload owns a `*-minikube.yaml`. Each application has its own Dockerfile. `minikube/monitoring/` holds Grafana and Prometheus configuration; monitoring runs in its own namespace. `legacy/original-robotshop/` retains reference application source.

## Accounts, products and payments

Login is required for checkout. Customers shop, admins manage products, and the single super admin manages roles and store settings. There is **no default administrator password**. Follow the [bootstrap and permissions guide](docs/architecture/identity-and-admin.md).

The merchant catalogue contains twenty robots; product images are labelled concept renders. Synthetic test profiles/reviews remain separate from authentic customer accounts and ratings. See [catalogue and review operations](docs/deployment/robotics-showcase.md).

Payments remain unavailable until Razorpay credentials are configured. Minikube defaults to test mode. Live payments require deliberate merchant configuration, supported currency and HTTPS. The webhook path for this deployment is `/roboshop/api/payments/webhook`. See [payment setup](services/payment-service/README.md). Carrier fulfilment, refunds and disputes are not automated.

## AI and observability

No LLM is enabled by default. The super admin can test and activate Amazon Bedrock or an approved Ollama endpoint under **Admin → AI / LLM configuration**. See [provider setup](docs/deployment/llm-providers.md).

Application metrics are private `/metrics` endpoints. Configure scrape targets in `minikube/monitoring/prometheus/values.yaml`; see [Prometheus](minikube/monitoring/prometheus/README.md). Traces go through the OpenTelemetry collector to Jaeger. Jaeger storage is ephemeral in this sandbox.

## Verification and limits

```bash
npm run frontend:typecheck
npm run frontend:build
npm test
npm run evaluate
python3 tests/minikube-manifests.test.py
```

Full tests require the documented language dependencies and local integration services; see [test instructions](tests/README.md). Per-service CI builds/pushes images to ECR; see [ECR setup](docs/deployment/ecr-ci.md).

The gateway’s durable JSON order ledger remains single-writer: keep one gateway replica and back up its volume alongside MongoDB and PostgreSQL. This Minikube configuration is a development sandbox, not a highly available production deployment.

## Service ownership

Services build from their own directories and own their dependency manifests, assets and service-specific tooling. For example: `docker build -t robotshop-frontend:local services/frontend`. Root scripts coordinate the platform. See [service boundaries and repository extraction](docs/architecture/service-repositories.md) for local tests, service-owned libraries and the future repository split.

### Optional Finder widget

The standalone Python [Finder service](services/finder/README.md) supplies the
assistant on every storefront page and supports embedding on other websites.
It builds as `robotshop-finder:local`. Scale `deployment/finder` to zero to hide
it without disabling the storefront. See its README for embedding and configuration.

### Deploy ECR images from GitHub Actions

Run the per-service CI workflows first, then **Actions → Deploy-Minikube → Run
workflow** on the default branch. Deployment selects the newest CI-published image
in each ECR repository and pins it by digest. It deploys infrastructure, SMTP,
then applications in dependency order, and finishes with catalogue publication
and ingress/TLS. It does not build or load local images.

Runner requirements:

- A Linux self-hosted runner with `self-hosted` and `linux` labels, access to the
  intended cluster, AWS CLI, kubectl, Python/PyYAML and OpenSSL.
- `AWS_REGION` set to the ECR region (`us-east-1` for the current Terraform stack).
  Use runner AWS credentials or configure `AWS_ROLE_ARN` for OIDC. The identity
  needs ECR describe, authorization-token and image-pull permissions.
- Traefik, cert-manager and the Let's Encrypt issuer already installed.
- The runner uses `$HOME/.kube/config`. Set `MINIKUBE_KUBECONFIG` to override it
  with an existing absolute path. Credentials remain on the runner.

Choose profile/context `mk4` or your installed profile. Installer replacement
profiles are resolved automatically. Runs are manual, default-branch only, and
serialized. A failed rollout stops later steps; earlier service updates remain.
Existing data and account credentials are preserved. Finder remains optional.

Every deployment refreshes the ECR pull secret. Tokens expire after 12 hours;
a new node or uncached image may require a refresh. Rerun the workflow to refresh credentials. See [ECR deployment](docs/deployment/ecr-ci.md#deploy-the-newest-ecr-images-to-minikube).

If a run stays **Queued**, check the runner labels and online status. For preflight
failures, check `aws sts get-caller-identity`, `kubectl --context=mk4 get nodes`
and `python3 -c 'import yaml'` as the runner user.

Build and push one service using its **Actions → service image → Run workflow** entry.
Omit `--service` to build every application image. The workflow keeps all build
steps and deployment in one job so they share the same host Docker images; a
failed service build stops its deployment and all subsequent service steps.

To build and deploy one application manually (its dependencies must already exist):

```bash
bash build-images.sh --service frontend --local
bash deploy-minikube.sh --service frontend --load-images
```

For a fresh staged deployment, run `bash deploy-minikube.sh --infrastructure` first,
then process application services in the workflow order, and finish with
`bash deploy-minikube.sh --finalize`. Single-service mode loads/restarts only that
application and does not republish the catalogue or change ingress. The existing
full-stack command `bash deploy-minikube.sh --load-images` remains supported.
