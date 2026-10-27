> Deployment-script cleanup: imperative application deployment commands in this
> document are retired. Use the Argo CD catalog and the five supported commands
> documented in `docs/operations/scripts.md`. Historical examples below are not
> runnable deployment instructions.

# Deploy all RoboShop services to Minikube

Each runnable service has its own **`services/<service>/<resource-name>-<kind>-minikube.yaml`**. The root **`scripts/deploy/deploy-minikube.sh`** applies all 18 in dependency order into `roboshop-ai`, checking readiness between services. Each application keeps its internal libraries in its own `lib/` folder; these libraries are not separate workloads.

## Local images on the Vultr Minikube host

Run from the repository root. Install Python 3 with PyYAML in your virtual environment, and have Docker, Minikube and kubectl available:

```bash
python3 -m pip install PyYAML
bash build-images.sh
bash scripts/deploy/deploy-minikube.sh --load-images
```

Application image publishing targets `linux/arm64`. Use `bash scripts/images/build-push-ecr.sh` on an ARM64 Docker engine to publish `:local` images, or the service CI workflows to publish `:latest`. CI requires a runner with `self-hosted`, `linux`, and `ARM64` labels. Cluster nodes must be ARM64. Infrastructure images are pulled from upstream multi-architecture registries; Kubernetes selects their ARM64 variant.

The script follows the selected profile saved by `minikube/install.sh` (base `PROFILE=mk4`). The profile and Kubernetes context must match when loading images. The default deploy command loads images and restarts applications. To deliberately apply manifests only (without an image refresh), run:

```bash
bash scripts/deploy/deploy-minikube.sh --manifests-only
```

Local images must be available to every node where pods may schedule. This script does not build images automatically. For private registry images, configure registry access/image pull credentials on the cluster before deploying.

## Deploy from your Mac using registry images

First build and push your images to a registry accessible to the cluster, using the same prefix and local tag as the build script. Then:

```bash
export KUBECONFIG="$HOME/.kube/vultr-minikube.json"
IMAGE_PREFIX=registry.example.com/team/roboshop KUBE_CONTEXT=mk4 \
  bash scripts/deploy/deploy-minikube.sh --registry-images
```

Replace the example prefix with your registry prefix; publish every application image with the local tag. The renderer changes application image references only; infrastructure images retain their checked-in versions. Run `--load-images` on the actual Minikube host, not on a Mac pointed at the remote cluster.

## HTTPS access at jithendar.com/roboshop

Traefik strips `/roboshop` before forwarding to NGINX. `FRONTEND_BASE_PATH=/roboshop` rewrites asset and navigation URLs; keep `PUBLIC_ORIGIN=https://jithendar.com` without a path.

Open **https://jithendar.com/roboshop/** (admin: `/roboshop/admin`). HTTP redirects to HTTPS. WordPress continues serving `/`; monitoring retains `/grafana` and `/prometheus`.

Prerequisites: DNS points to Vultr, Traefik exposes public ports 80/443, and cert-manager's `letsencrypt-prod` ClusterIssuer is Ready. The deploy script checks these cluster resources, applies the named `*-ingress.yaml` and `*-middleware.yaml` resources, and waits up to three minutes for the certificate. This certificate and its TLS Secret live in `roboshop-ai` because TLS Secrets cannot be referenced across namespaces.

On the Minikube host, rebuild the frontend and NGINX changes using the fixed local tag:

```bash
bash build-images.sh
bash scripts/deploy/deploy-minikube.sh --load-images
```

If TLS is pending:

```bash
kubectl -n roboshop-ai get ingress,certificate,certificaterequest,order,challenge
kubectl -n roboshop-ai describe certificate jithendar-com
curl -I https://jithendar.com/roboshop/
```

Check DNS, public ports, issuer status and challenge events. Do not repeatedly delete certificates while troubleshooting. For blank pages or 404 assets, reload the rebuilt images and restart the frontend/NGINX deployments. Razorpay webhook URLs must include `/roboshop/api/payments/webhook` when using this ingress.

MCP is a **stdio server**, not HTTP: its deployment keeps stdin open and intentionally has no Service or TCP health probe. A client can launch a separate protocol process through:

```bash
kubectl -n roboshop-ai exec -i deployment/mcp-server -- python services/mcp-server/server.py
```

Do not add `-t` for stdio protocol clients. Set a valid `MCP_SESSION_TOKEN` in `roboshop-secrets` and restart the MCP deployment if authenticated tools require a customer session; no user session is fabricated automatically.

## Files and dependencies

| Layer | Service folders |
| --- | --- |
| Data and messaging | mongodb, postgres (workload `shipping-db`), redis, rabbitmq |
| Tracing | jaeger, otel-collector |
| APIs and AI | catalogue-service, catalogue-service, moks, payment-service, shipping-service, user-service, ai-gateway |
| Web and tools | frontend, nginx, mcp-server |

- `minikube/roboshop/roboshop-ai-namespace.yaml, minikube/roboshop/roboshop-config-configmap.yaml`: namespace and the single `roboshop-config` ConfigMap (environment settings and service configuration files).
- `minikube/roboshop/deployment.py`: renderer and first-install credential initialization.
- Each service YAML: Service (where applicable), Deployment/StatefulSet, probes, resources, and required PVC definitions and references to the shared ConfigMap.
- The shared ConfigMap contains Mongo/Postgres init scripts and Redis/RabbitMQ/collector configuration. Each volume explicitly selects its own file with `items`, preventing unrelated init scripts from being mounted. Edit these files in `minikube/roboshop/roboshop-ai-namespace.yaml, minikube/roboshop/roboshop-config-configmap.yaml`. Database init scripts only run on **empty** data volumes.

Prometheus is managed by `minikube/deploy-prometheus.sh` in `monitoring`; this application installer does not deploy a second Prometheus or reset monitoring. To collect application metrics, add actual service endpoints to `minikube/monitoring/prometheus/values.yaml` under `extraScrapeConfigs` and redeploy Prometheus. Traces flow to the included Jaeger, which uses ephemeral sandbox storage.

## Secrets and persistence

The script generates `roboshop-secrets` once, with independent random MongoDB, PostgreSQL, Redis, RabbitMQ and internal service credentials. Secrets are sent to Kubernetes on stdin and never written into the manifests or printed. An existing Secret is reused. If known data PVCs exist without the Secret, installation stops to avoid breaking database authentication.

Persistent claims: `mongodb-data` (5 GiB), `shipping-postgres` (5 GiB), `rabbitmq-data` (2 GiB), `gateway-data` (2 GiB). RabbitMQ uses a StatefulSet and stable node name to preserve broker identity. Redis is a disposable cache. Keep original credentials with backups; replacing a Secret does not update passwords in persisted databases. Do not delete PVCs to fix a startup failure.

This is a single-instance sandbox configuration. Payment mode defaults to **test** and payments stay unavailable until real sandbox Razorpay credentials are configured. Optional Secret keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `MCP_SESSION_TOKEN`. Restart affected deployments after changing environment-backed credentials. Live payments require an explicit HTTPS origin and the application's normal production/payment configuration.

Registration challenges are disabled for the sandbox, and no administrator or external LLM provider is automatically configured. Follow the existing [identity/admin guide](../../docs/architecture/identity-and-admin.md) and LLM configuration instructions when enabling those capabilities. Keep this development setup private until production settings are configured.

## Validate without deployment

```bash
bash scripts/deploy/deploy-minikube.sh --render-only /tmp/roboshop-manifests
python3 tests/minikube-manifests.test.py
```

Rendered files contain no credential values. `--render-only` needs Python/PyYAML but no cluster or Docker. Both render and deployment work from any current directory because paths resolve relative to the script.

## Troubleshooting

```bash
kubectl -n roboshop-ai get pods,pvc,svc
kubectl -n roboshop-ai get events --sort-by=.lastTimestamp
kubectl -n roboshop-ai logs deployment/ai-gateway --tail=80
kubectl -n roboshop-ai logs deployment/shipping-service --tail=80
kubectl -n roboshop-ai logs statefulset/rabbitmq --tail=80
```

The installer stops at the first failing rollout and prints diagnostics. Fix the issue and rerun; it reuses data/credentials.

- **ImagePullBackOff:** ensure image names/tags exist, registry access works, and local images were loaded into every Minikube node.
- **Pending:** inspect scheduling and PVC events; ensure a default StorageClass and enough CPU/memory exist. The full app runs alongside your existing monitoring/WordPress workloads and may need additional capacity.
- **Database login failure:** restore the Secret matching the original data; do not generate new passwords over old volumes.
- **Config changes not reflected:** environment and subPath-mounted configuration may require `kubectl rollout restart deployment/NAME` (or `statefulset/rabbitmq`) after applying changes.
- **Shipping starts slowly:** initial location migration/import can take time; startup/readiness checks allow a ten-minute rollout window.

### Rebuilding the same local tag

`bash build-images.sh` and `bash scripts/deploy/deploy-minikube.sh --load-images` always use matching `:local` application images. An old exported `IMAGE_TAG` is ignored. The loader checks that all twelve images exist in host Docker, explicitly overwrites Minikube's cached tags from that daemon, then restarts each application deployment and waits for readiness. Databases and infrastructure are not restarted by this image refresh. Run the loader on the Minikube host. The default command now performs the same refresh as `--load-images`. Only `--manifests-only` skips refreshing images and forcing restarts. `--registry-images` uses `Always` pull policy and restarts applications so a changed registry `:local` tag is fetched. Progress is sequential: a service waiting for readiness delays all later services, including frontend. The script prints each step and the final running image IDs; an incomplete run is not a successful release.

### Shipping exits while binding the Redis port

If the previous container log reports `spring.data.redis.port` cannot parse `tcp://...:6379`, Kubernetes service-link variables collided with the application's `REDIS_PORT` setting. The manifests disable service links and shipping explicitly sets `REDIS_PORT=6379` and `RABBITMQ_PORT=5672`. Apply the updated shipping manifest or rerun the deployment script; no image rebuild or database reset is needed. Service discovery continues using Kubernetes DNS.

### HTTPS returns 502 with NGINX "Host not found"

## User service

The ECR deployment workflow deploys `user-service` before `ai-gateway`.
Account data stays in the existing MongoDB collections. See
[the user-service migration and deployment guide](../../services/user-service/README.md).
`scripts/deploy/deploy-minikube.sh` adds a missing `USER_SERVICE_TOKEN` to the existing Secret
without rotating stored database passwords. User-service now uses SES directly;
configure its SMTP credentials in `roboshop-secrets`.


### GitHub Actions: newest ECR images

Use **Actions → Deploy-Minikube → Run workflow**. All ECR lookup, credential setup,
manifest apply and restart commands live in `deploy-minikube.yml`. The workflow
uses the service YAML files directly, with ECR `:latest` images, `Always` pull policy and the `ecr-pull` secret.
It applies manifests and requests application restarts without waiting for rollout or
TLS readiness. A successful run does not confirm application health. Existing SQL
import and catalogue publication still require running pods.
It does not call root build/deployment scripts. See [ECR deployment](../../docs/deployment/ecr-ci.md).


### Consolidated configuration

Application configuration is maintained in `roboshop-config`; credentials,
including SES, MFA and optional `DEMO_MONGODB_URL`, are in `roboshop-secrets`.
The remaining namespace resources serve Kubernetes integrations: `ecr-pull` is a
Docker registry Secret, `jithendar-com-tls` is managed by cert-manager, and
`kube-root-ca.crt` is generated by Kubernetes. Do not combine or manually replace
those controller-managed resources with application settings.

The old SMTP workload, certificates, issuers and signing Secret are retired. Its
queue PVC is preserved. The demo seeder now patches only `DEMO_MONGODB_URL` in the
shared Secret, never overwriting other credentials.

### Health probes

Application liveness/startup probes use local `/health`. Gateway readiness uses
`/api/ready` for core MongoDB/catalogue/user/cart dependencies, while NGINX `/ready`
forwards that core result. Optional AI, Finder, recommendation and telemetry failures
do not take the storefront out of service. `/api/ops` is diagnostic only. See the
[per-workload contracts and recovery behavior](../../docs/architecture/health-checks.md).

Razorpay sandbox deployments use separate `RAZORPAY_TEST_*` credentials in the same
`roboshop-secrets` Secret. Retain them when adding `RAZORPAY_LIVE_*` credentials so
old orders reconcile in their original environment. See the [sandbox checklist and
audited recovery procedure](../../docs/deployment/razorpay-sandbox.md).

## First deployment through GitHub Actions

Deploy-Minikube supports a fresh application namespace. It checks cluster access,
Traefik and Let's Encrypt first, then applies the namespace/configuration and
initializes `roboshop-secrets` before creating ECR pull credentials or workloads.
Existing application passwords are reused. If persisted application data exists
without the original Secret, deployment stops; restore the original credentials.

External integrations (Razorpay, Turnstile, SES and LLM providers) still require
their own configuration; bootstrap does not invent these credentials. Checked-in
configuration enables Turnstile, so registration requires its keys.

The workflow applies manifests and requests restarts without waiting for general
application rollout status. The SQL import alone waits for PostgreSQL to accept
connections, because a fresh database pod cannot immediately execute an import.
