# Deploy all RobotShop services to Minikube

Each runnable service has its own **`services/<service>/<service>-minikube.yaml`**. The root **`deploy-minikube.sh`** applies all 16 in dependency order into `robotshop-ai`, checking readiness between services. The `common`, `shared` and `python-common` folders are libraries/configuration, not workloads.

## Local images on the Vultr Minikube host

Run from the repository root. Install Python 3 with PyYAML in your virtual environment, and have Docker, Minikube and kubectl available:

```bash
python3 -m pip install PyYAML
bash build-images.sh
bash deploy-minikube.sh --load-images
```

`--load-images` loads the ten application images into the selected Minikube profile before applying manifests. Build on the host's architecture, or use `build-images.sh --platform linux/amd64` for an amd64 cluster. Existing `build-images.sh` does not push images. Infrastructure images are pulled from their upstream registries by Kubernetes.

The script follows the selected profile saved by `minikube/install.sh` (base `PROFILE=mk4`). The profile and Kubernetes context must match when loading images. If you already loaded the images on all nodes, simply run:

```bash
bash deploy-minikube.sh
```

Local images must be available to every node where pods may schedule. This script does not build images automatically. For private registry images, configure registry access/image pull credentials on the cluster before deploying.

## Deploy from your Mac using registry images

First build and push your images to a registry accessible to the cluster, using the same prefix and local tag as the build script. Then:

```bash
export KUBECONFIG="$HOME/.kube/vultr-minikube.json"
IMAGE_PREFIX=registry.example.com/team/robotshop KUBE_CONTEXT=mk4 \
  bash deploy-minikube.sh
```

Replace the example prefix with your registry prefix; publish every application image with the local tag. The renderer changes application image references only; infrastructure images retain their checked-in versions. Run `--load-images` on the actual Minikube host, not on a Mac pointed at the remote cluster.

## HTTPS access at jithendar.com/roboshop

Open **https://jithendar.com/roboshop/** (admin: `/roboshop/admin`). HTTP redirects to HTTPS. WordPress continues serving `/`; monitoring retains `/grafana` and `/prometheus`.

Prerequisites: DNS points to Vultr, Traefik exposes public ports 80/443, and cert-manager's `letsencrypt-prod` ClusterIssuer is Ready. The deploy script checks these cluster resources, applies `ingress.yaml`, and waits up to three minutes for the certificate. This certificate and its TLS Secret live in `robotshop-ai` because TLS Secrets cannot be referenced across namespaces.

On the Minikube host, rebuild the frontend and NGINX changes using the fixed local tag:

```bash
bash build-images.sh
bash deploy-minikube.sh --load-images
```

Traefik strips `/roboshop` before passing requests to NGINX. NGINX's `FRONTEND_BASE_PATH=/roboshop` rewrites HTML asset and navigation links; the frontend resolves API, product, and image URLs from its module URL. The same images work at `/` in Compose with the default empty path. `PUBLIC_ORIGIN=https://jithendar.com` enables secure cookies and the correct same-origin checks; do not add the path to this value.

If TLS is pending:

```bash
kubectl -n robotshop-ai get ingress,certificate,certificaterequest,order,challenge
kubectl -n robotshop-ai describe certificate jithendar-com
curl -I https://jithendar.com/roboshop/
```

Check DNS, public ports, issuer status and challenge events. Do not repeatedly delete certificates while troubleshooting. For blank pages or 404 assets, reload the rebuilt images and restart the frontend/NGINX deployments. Razorpay webhook URLs must include `/roboshop/api/payments/webhook` when using this ingress.

MCP is a **stdio server**, not HTTP: its deployment keeps stdin open and intentionally has no Service or TCP health probe. A client can launch a separate protocol process through:

```bash
kubectl -n robotshop-ai exec -i deployment/mcp-server -- python services/mcp-server/server.py
```

Do not add `-t` for stdio protocol clients. Set a valid `MCP_SESSION_TOKEN` in `robotshop-secrets` and restart the MCP deployment if authenticated tools require a customer session; no user session is fabricated automatically.

## Files and dependencies

| Layer | Service folders |
| --- | --- |
| Data and messaging | mongodb, postgres (workload `shipping-db`), redis, rabbitmq |
| Tracing | jaeger, otel-collector |
| APIs and AI | product-ingestion, recommendation-service, shopping-agent, sre-copilot, payment-service, shipping-service, ai-gateway |
| Web and tools | frontend, nginx, mcp-server |

- `minikube/robotshop/config.yaml`: namespace and common non-secret application settings.
- `minikube/robotshop/deployment.py`: renderer and first-install credential initialization.
- Each service YAML: Service (where applicable), Deployment/StatefulSet, probes, resources, and required PVC/ConfigMap definitions.
- Mongo/Postgres initialization ConfigMaps contain copies of their existing init scripts. When changing these scripts or Redis/RabbitMQ/collector configuration, update the corresponding YAML ConfigMap too. Database init scripts only run on **empty** data volumes.

Prometheus is managed by `minikube/deploy-prometheus.sh` in `monitoring`; this application installer does not deploy a second Prometheus or reset monitoring. To collect application metrics, add actual service endpoints to `minikube/monitoring/prometheus/values.yaml` under `extraScrapeConfigs` and redeploy Prometheus. Traces flow to the included Jaeger, which uses ephemeral sandbox storage.

## Secrets and persistence

The script generates `robotshop-secrets` once, with independent random MongoDB, PostgreSQL, Redis, RabbitMQ and internal service credentials. Secrets are sent to Kubernetes on stdin and never written into the manifests or printed. An existing Secret is reused. If known data PVCs exist without the Secret, installation stops to avoid breaking database authentication.

Persistent claims: `mongodb-data` (5 GiB), `shipping-postgres` (5 GiB), `rabbitmq-data` (2 GiB), `gateway-data` (2 GiB). RabbitMQ uses a StatefulSet and stable node name to preserve broker identity. Redis is a disposable cache. Keep original credentials with backups; replacing a Secret does not update passwords in persisted databases. Do not delete PVCs to fix a startup failure.

This is a single-instance sandbox configuration. Payment mode defaults to **test** and payments stay unavailable until real sandbox Razorpay credentials are configured. Optional Secret keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `MCP_SESSION_TOKEN`. Restart affected deployments after changing environment-backed credentials. Live payments require an explicit HTTPS origin and the application's normal production/payment configuration.

Registration challenges are disabled for the sandbox, and no administrator or external LLM provider is automatically configured. Follow the existing [identity/admin guide](../../docs/architecture/identity-and-admin.md) and LLM configuration instructions when enabling those capabilities. Keep this development setup private until production settings are configured.

## Validate without deployment

```bash
bash deploy-minikube.sh --render-only /tmp/robotshop-manifests
python3 tests/minikube-manifests.test.py
```

Rendered files contain no credential values. `--render-only` needs Python/PyYAML but no cluster or Docker. Both render and deployment work from any current directory because paths resolve relative to the script.

## Troubleshooting

```bash
kubectl -n robotshop-ai get pods,pvc,svc
kubectl -n robotshop-ai get events --sort-by=.lastTimestamp
kubectl -n robotshop-ai logs deployment/ai-gateway --tail=80
kubectl -n robotshop-ai logs deployment/shipping-service --tail=80
kubectl -n robotshop-ai logs statefulset/rabbitmq --tail=80
```

The installer stops at the first failing rollout and prints diagnostics. Fix the issue and rerun; it reuses data/credentials.

- **ImagePullBackOff:** ensure image names/tags exist, registry access works, and local images were loaded into every Minikube node.
- **Pending:** inspect scheduling and PVC events; ensure a default StorageClass and enough CPU/memory exist. The full app runs alongside your existing monitoring/WordPress workloads and may need additional capacity.
- **Database login failure:** restore the Secret matching the original data; do not generate new passwords over old volumes.
- **Config changes not reflected:** environment and subPath-mounted configuration may require `kubectl rollout restart deployment/NAME` (or `statefulset/rabbitmq`) after applying changes.
- **Shipping starts slowly:** initial location migration/import can take time; startup/readiness checks allow a ten-minute rollout window.

### Rebuilding the same local tag

`bash build-images.sh` and `bash deploy-minikube.sh --load-images` always use matching `:local` application images. An old exported `IMAGE_TAG` is ignored. The loader checks that all ten images exist in host Docker, explicitly overwrites Minikube's cached tags from that daemon, then restarts each application deployment and waits for readiness. Databases and infrastructure are not restarted by this image refresh. Run the loader on the Minikube host. Deployment without `--load-images` does not refresh cached images or force restarts.
