# RoboShop AI on Amazon EKS

A reproducible EKS deployment of RoboShop AI: Terraform for AWS, pinned Helm charts for the
cluster controllers, and rendered Kubernetes layers synced by Argo CD. It is a **personal
showcase project**. Nothing here has run production traffic, and no performance or availability
figures are claimed.

- Step-by-step deployment, verification, rollback and teardown: [RUNBOOK.md](RUNBOOK.md)
- Pinned versions and sources: [versions.md](versions.md)
- Diagrams (Mermaid sources and rendered SVGs): [diagrams/](diagrams/)

Reviewed against commit `692e72d` of this repository on 2026-10-30. Statements are marked:
**verified** (read in code or rendered/tested offline here), **proposed** (new configuration
in this folder, not yet run on AWS), or **unverified at runtime** (needs a real cluster).

> Licence note: this repository is proprietary (see `../../LICENSE`). Deploying your own copy
> requires the owner's written permission.

## What gets built

```
Internet ─▶ NLB (TCP 80/443, proxy protocol v2, IP targets)
         ─▶ Istio ingress gateway (TLS termination, cert-manager certificate)
         ─▶ web (NGINX) ─▶ ai-gateway ─▶ user / catalogue / cart / payment / shipping / currency / moks
                                     └─▶ outbox ─▶ RabbitMQ ─▶ shipping-worker (KEDA)  ─▶ PostgreSQL
                                                          └─▶ kafka-bridge ─▶ Kafka
```

| Layer | Folder | Applied by |
| --- | --- | --- |
| VPC, EKS, node group, add-ons, IAM, ECR, Secrets Manager container, log group | `terraform/` | `terraform apply` |
| Controllers (Karpenter, AWS LBC, cert-manager, External Secrets, Prometheus/Grafana, Istio, Gatekeeper, KEDA, OTel agent, Jaeger, Argo CD) | `platform/` | `platform/install.sh` (Helm) |
| Namespace, StorageClass, NodePools, secrets, TLS, mesh config, policies, apps, autoscaling, monitors | `k8s/` | `scripts/render.sh` → Git → Argo CD |
| One-off data jobs | `k8s/jobs/` | `kubectl apply` (explicit step) |

## Architecture from the code (verified)

| Area | What the code does | Evidence |
| --- | --- | --- |
| Public entry | `web` (NGINX) serves pages and proxies `/api` to `ai-gateway`, `/moks` to Moks, currency to `currency-service`; `/metrics` returns 404 | `services/web/nginx/snippets/routes.conf` |
| Gateway | Auth (via user-service), catalogue, cart, checkout/payments, admin, chat; owns the order ledger | `services/ai-gateway/server.py`, `lifecycle.py` |
| Accounts | user-service: MongoDB users, hashed sessions, MFA; calls shipping for purchase history | `services/user-service/server.py` |
| Catalogue | MongoDB reads/imports, recommendations | `services/catalogue-service` |
| Cart | Redis-backed carts (Redis is authoritative for editable carts) | `services/cart-service`, `postgres_store.py` header |
| Payments | Razorpay orders and verification; **test mode by default** (`PAYMENT_MODE=test`) | `services/payment-service`, `k8s/apps/config/roboshop.env` |
| Currency | Go service, rates for display/checkout | `services/currency-service` |
| Shipping | Java; PostgreSQL locations/quotes; RabbitMQ consumer when `MESSAGING_ENABLED=true` | `OrderEvents.java`, `application.yml` |
| Order ledger | `COMMERCE_BACKEND=json` (default, **single writer**, one replica, PVC) or `postgres` (transactional, leased outbox, multi-replica) | `lifecycle.py`, `postgres_store.py` |
| Outbox → RabbitMQ | Publisher confirms to `roboshop.orders`; quorum queues; DLQ `roboshop.shipping.failed` after 5 failures | `events.py`, `OrderEvents.java` |
| Kafka | Separate queue `roboshop.kafka.orders` → kafka-bridge → Kafka topics; analytics only, never on the checkout path | `services/kafka-bridge/README.md` |
| Moks | Gateway calls Moks for `/api/chat`; Moks retrieves from catalogue, checks config with the gateway, calls Bedrock or Ollama only if configured. **No MCP on this path**; no provider is configured by default | `services/moks/README.md`, `server.py` |
| MCP | Private `mcp-server` (Streamable HTTP or stdio) calls the gateway with the caller's own session; no ingress | `services/mcp-server/README.md` |
| Telemetry | OTLP traces from every service; `/metrics` on each service port; JSON logs on stdout; Langfuse optional, metadata only | service `lib/runtime.*`, Moks README |

Not every request visits every service: browsing touches web → gateway → catalogue; checkout adds
cart, payment, user and shipping; chat adds Moks (and a model only when one is configured).

## Design decisions

**NLB → Istio ingress gateway, not ALB.** Istio's gateway already does L7 routing, TLS and
identity; an ALB in front would add a second L7 hop and a second place for routing rules. The NLB
(AWS Load Balancer Controller, `loadBalancerClass: service.k8s.aws/nlb`) uses **IP targets**
(gateway pods registered directly), TCP passthrough on 80/443, an HTTP health check on the
gateway's `15021 /healthz/ready`, cross-zone load balancing, and a controller-managed frontend
security group restricted by `loadBalancerSourceRanges`. **TLS terminates on the gateway pods**
with a Let's Encrypt certificate from cert-manager (DNS-01 via Route 53 and Pod Identity).
**Client IPs** reach Envoy through **proxy protocol v2** (`gatewayTopology.proxyProtocol`).
*Alternative:* terminate TLS on the NLB with ACM (`aws-load-balancer-ssl-cert`) to get managed
renewal, at the cost of plaintext NLB→pod traffic inside the VPC unless you re-encrypt.
*Internal endpoints:* add a second gateway Service with `aws-load-balancer-scheme: internal`.

**Istio sidecar mode, not ambient.** Sidecars give L7 authorization on every hop without waypoint
proxies, and an explicit, namespace-level enrollment boundary (`istio-injection=enabled` on
`roboshop-ai` only; data stores opt out per pod). The Istio CNI node agent removes the privileged
`istio-init` container from application pods, and native sidecars let Jobs finish and draining
workers keep networking until they exit. Istio documents an EKS caveat for ambient with pod
security groups in strict mode; this design avoids that path.

**Retries and timeouts.** Mesh-wide automatic HTTP retries are **off**
(`defaultHttpRetryPolicy.attempts: 0`). Only idempotent GETs to catalogue and currency retry, and
only on `connect-failure,refused-stream`. Gateway and payment routes have explicit timeouts and
`attempts: 0`, so a checkout or payment mutation is never replayed by the mesh.

**Three separate authorization layers.**
Gatekeeper decides what may be *admitted* to the cluster; Istio `AuthorizationPolicy` decides
which *workload identity* may call which service (one ServiceAccount per workload, verified call
edges only); the applications decide what a *user* may do (sessions, roles, cart ownership).

**"opengateway policies" = OPA Gatekeeper (assumption).** Nothing in the repositories names
another product. Policies cover approved registries + digest pinning, resource requests/limits,
non-root/restricted pods, no auto-mounted tokens, ownership labels, and public exposure only
through the Istio gateway. They match only `roboshop-ai` (exposure: all namespaces but
`kube-system`), so Istio, CSI, VPC CNI, KEDA, Karpenter and agents are never blocked. Exceptions
are narrow and visible: `roboshop.dev/policy-exception=stateful-entrypoint` on the demo data
stores (official images start as root and drop privileges) skips only the restricted-pod rule;
the injected `istio-proxy`/`istio-validation` containers are exempt from digest pinning only
(istiod pins their version).

**NetworkPolicy.** Ingress isolation is enforced **only because** the VPC CNI add-on is
installed with `enableNetworkPolicy=true`; without a policy engine the same YAML does nothing.

**Pod Identity, not IRSA.** One trust policy for all roles, no per-cluster OIDC rewriting, and
every controller used here supports it. Roles: EBS CSI, AWS LBC, External Secrets (read-only on
`<prefix>/<env>/*`), OTel agent (one log group), cert-manager (one hosted zone, optional), Moks
(listed Bedrock models, optional), Karpenter (module-managed).

**Secrets.** The lab creates Kubernetes Secrets by script. On EKS, values live in AWS Secrets
Manager and External Secrets Operator syncs them into the same `roboshop-secrets` Secret the
manifests already reference. Terraform creates the empty container; `scripts/put-secrets.sh`
generates values locally and never prints them.

**KEDA on a real consumer.** The only horizontally safe queue consumer is shipping's RabbitMQ
listener: it acknowledges after the insert commits, deduplicates on `event_id UNIQUE` with
`ON CONFLICT DO NOTHING`, retries 5 times then dead-letters, and serializes migrations with an
advisory lock. kafka-bridge cannot scale independently (it shares a pod with the single Kafka
broker). So the EKS overlay runs the same shipping image twice: `shipping-service` (HTTP,
consumer off) and `shipping-worker` (consumer on, no Service), and KEDA owns the worker's HPA.
No application code changed.

**Karpenter with a stable system node group.** Karpenter, CoreDNS, istiod and the other
controllers run on a tainted On-Demand managed node group, so node provisioning never depends on
nodes Karpenter itself created. Two NodePools: `general` (On-Demand, everything by default) and
`spot` (tainted; only `shipping-worker` and the backlog test opt in). Both are arm64-only with CPU
and memory limits, consolidation budgets and expiry. An optional, not-applied `gpu` pool is
provided for a self-hosted model. Cluster Autoscaler is not installed.

**Observability baseline, one agent per signal.** Metrics: Prometheus/Grafana
(kube-prometheus-stack), scraping Istio-merged app metrics on `:15020` so mTLS needs no
exceptions. Logs and traces: one OpenTelemetry Collector DaemonSet (contrib) that tails pod logs
to CloudWatch Logs and forwards OTLP traces to Jaeger, with query strings, auth headers,
cookies, emails and secret-looking values removed before export. Control-plane logs: `api`,
`audit`, `authenticator` to CloudWatch with 30-day retention. Langfuse stays optional and
metadata-only. *Alternatives kept explicit:* CloudWatch Container Insights / X-Ray instead of
Prometheus/Jaeger, or the lab's Loki/Alloy and ELK; do not run them alongside this agent.

**Argo CD with rendered manifests.** `scripts/render.sh` resolves image digests and reader values
into `clusters/<cluster>/<layer>/manifests.yaml`; you review that diff in Git and Argo CD syncs it
with sync waves. Controllers stay Helm-installed so Argo never manages what it depends on. Argo
ignores `shipping-worker` replicas, which KEDA owns.

## Lab (Minikube) versus this EKS design

| Topic | Lab | EKS (this folder) |
| --- | --- | --- |
| Ingress | Traefik, `/roboshop` prefix | NLB → Istio gateway, domain root |
| Node placement | `nodeSelector: mk4-m03` (hostPath data) | Removed; EBS gp3 volumes, zone-aware scheduling |
| Image pulls | `ecr-pull` Secret refreshed by CronJob, `:latest`, `Always` | Node role pulls from ECR; images pinned by digest |
| Secrets | Created by script | Secrets Manager + External Secrets |
| Identity | Shared default ServiceAccount | One ServiceAccount per workload |
| Gateway data dir | Root init container chowns hostPath | Removed; `fsGroup` on EBS |
| Shipping | One Deployment consumes and serves HTTP | `shipping-service` (HTTP) + `shipping-worker` (KEDA) |
| Replicas | 1 each | 2 for stateless services; 1 for gateway (JSON ledger), Moks, MCP, data stores |
| Telemetry | Collector → Jaeger, Alloy → Loki | OTel agent → Jaeger + CloudWatch Logs; Prometheus via Istio merge |

## Demo profile versus production

The default profile is a **demonstration**. It is not highly available:

- MongoDB, PostgreSQL, Redis, RabbitMQ and Kafka run as **single pods on single EBS volumes**.
  Losing a node's zone or volume loses that service until restore.
- The gateway uses the **JSON ledger**: exactly one replica, `Recreate` strategy, a single PVC.
- Redis carts are not persisted (`appendonly no`); a Redis restart empties carts.
- Jaeger stores traces in memory.
- One NAT gateway; no interface endpoints; Gatekeeper's webhook fails open.

For production, change these deliberately (none are automated here):

| Concern | Production option |
| --- | --- |
| Order ledger | `COMMERCE_BACKEND=postgres` on Amazon RDS/Aurora PostgreSQL (Multi-AZ), schema via `commerce_migrate.py --init-schema` as a reviewed Job, then scale the gateway; follow `docs/deployment/postgres-commerce-migration.md` |
| MongoDB | MongoDB Atlas or a 3-member replica set across AZs |
| Shipping PostgreSQL | RDS PostgreSQL Multi-AZ with TLS (`SHIPPING_DB_TLS=true`) |
| Redis | ElastiCache (Multi-AZ) with TLS and AUTH |
| RabbitMQ | Amazon MQ for RabbitMQ (cluster deployment) |
| Kafka | Amazon MSK, with kafka-bridge deployed separately |
| Backups | AWS Backup for EBS/RDS with tested restores; document RPO/RTO before go-live |
| Network | `single_nat_gateway = false`, interface endpoints on, Istio egress control |
| Policy | Gatekeeper `failurePolicy: Fail`, 3 replicas; constraints in `deny` |
| Tracing | Persistent Jaeger storage or X-Ray |

## Approximate resource requirements

Measured from the rendered manifests (requests, including Istio sidecar requests): applications
and data stores request about **1.9 vCPU and 4.3 GiB**. Add Prometheus (~0.2 vCPU / 1 GiB),
ingress gateways, Jaeger and per-node agents. Expect the two system nodes (2 × 2 vCPU / 8 GiB,
`m7g.large`) plus **two to three** Karpenter-launched 2–4 vCPU arm64 nodes for the demo. Storage:
~45 GiB of gp3 (Prometheus 20, MongoDB 10, Kafka 5, PostgreSQL 5, RabbitMQ 2, gateway 2).

### Quotas and permissions

- EC2 On-Demand Standard vCPUs >= 16 and Spot vCPUs >= 8 in the region; one Elastic IP per NAT
  gateway; one NLB; `scripts/preflight.sh` prints the current values.
- The identity running Terraform needs permissions to create VPC, EKS, IAM roles/policies, KMS,
  CloudWatch Logs, SQS, EventBridge, ECR and Secrets Manager resources. Use an admin role in a
  sandbox account, or derive a scoped policy from a `terraform plan`.
- Tools: AWS CLI v2, Terraform >= 1.10, kubectl 1.35–1.37, Helm >= 3.8 (OCI), envsubst
  (gettext), jq, curl, git.

### Cost drivers (no prices quoted; check the AWS pricing pages for your region)

- **EKS control plane**: charged per cluster-hour whether or not anything runs. Extended-support
  versions cost more; 1.36 is in standard support until Aug 2027.
- **NAT gateways**: hourly per gateway plus per-GB processed. Image pulls from ECR travel partly
  through S3 (free gateway endpoint here) and partly through NAT unless interface endpoints are on.
- **Interface endpoints**: hourly per endpoint per AZ; worthwhile when NAT data costs exceed them.
- **NLB**: hourly plus capacity units.
- **EC2**: two always-on system nodes plus Karpenter nodes; Spot lowers worker cost.
- **EBS**: gp3 GiB-month for every PVC and node root volume; `Retain` volumes keep billing after
  their PVC is deleted until you delete them (RUNBOOK K).
- **CloudWatch Logs**: ingestion per GB dominates; control-plane `audit` logs can be large.
- **An idle cluster still costs** the control plane, system nodes, NAT, NLB and volumes. Tear
  down (RUNBOOK K) when you are not using it.

## Offline checks

Run from the repository root. None of them need AWS credentials.

```bash
terraform -chdir=deploy/eks/terraform init -backend=false && terraform -chdir=deploy/eks/terraform validate
terraform -chdir=deploy/eks/terraform test                      # mocked AWS provider
RENDER_OFFLINE=1 RENDER_OUT=/tmp/roboshop-render deploy/eks/scripts/render.sh deploy/eks/env/example.env  # after filling placeholders
python3 deploy/eks/scripts/policy-precheck.py /tmp/roboshop-render/{apps,jobs}/manifests.yaml
(cd deploy/eks/k8s/gatekeeper && gator verify ./tests)          # requires gator v3.23.1
kubeconform -strict -ignore-missing-schemas /tmp/roboshop-render/*/manifests.yaml   # optional
```

## Layout

```
deploy/eks/
  terraform/        VPC, EKS, IAM (Pod Identity), Karpenter IAM/SQS, ECR, secret container, tests
  platform/         versions.env, Helm values, install.sh
  k8s/              platform, karpenter, secrets, tls, istio, gatekeeper, observability, apps, keda, jobs, argocd
  scripts/          preflight, put-secrets, render, verify, backlog-test, policy-precheck
  env/example.env   reader-specific, non-secret settings
  clusters/         rendered output per cluster (commit in your fork for Argo CD)
  diagrams/         Mermaid sources, SVG builder and rendered SVGs
```
