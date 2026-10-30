# Deploy RoboShop AI on Amazon EKS — runbook

Commands run from the **repository root** unless a step says otherwise. Placeholders look like
`<this>`; set them once in `deploy/eks/terraform/demo.tfvars` and `deploy/eks/env/<cluster>.env`.
No command here prints a secret value. Do not paste secret values into commands, issues or
screenshots.

Status of this runbook: **proposed**. Every file was validated offline (Terraform validate and
mocked plan tests, Helm template of every chart, kustomize builds, policy pre-check). It has
**not** been run end to end on AWS. Steps marked *(runtime check)* confirm behaviour that cannot
be proven offline.

Order matters: CRDs before the objects that use them, Karpenter before any workload that needs
nodes, the load balancer controller before the gateway Service, secrets before the pods that
mount them, policies in audit before enforcement, and stable capacity is never removed while
Karpenter depends on it.

---

## A. Prerequisites and reader configuration

**A1. Tools and identity**

```bash
aws --version; terraform version; kubectl version --client; helm version; envsubst --version | head -1; jq --version
aws sts get-caller-identity --query Arn --output text
```

Expected: Terraform >= 1.10, kubectl 1.35–1.37, Helm >= 3.8, AWS CLI v2; an IAM role (not the
root user) able to create the resources listed in README.md#quotas-and-permissions.
Failure: `ExpiredToken` → refresh your SSO/session (`aws sso login`).

**A2. Choose names and copy the templates**

```bash
cp deploy/eks/terraform/backend.hcl.example deploy/eks/terraform/backend.hcl
cp deploy/eks/terraform/demo.tfvars.example deploy/eks/terraform/demo.tfvars
cp deploy/eks/env/example.env deploy/eks/env/roboshop-demo.env
```

Edit all three. Required values: state bucket, region, AZs, your `/32` for the API, admin role
ARN, owner, public hostname in a Route 53 zone you control, ACME email, image tag (commit SHA).
All three files are git-ignored except `example.env`.

**A3. Preflight (read-only)**

```bash
deploy/eks/scripts/preflight.sh deploy/eks/env/roboshop-demo.env
```

Expected: every line `ok`, quotas printed. Failure: `FAIL ... <placeholders>` → finish A2.
Low vCPU quota → request an increase before B (EC2 launches fail late, inside Karpenter).

---

## B. Infrastructure (Terraform)

Working directory: `deploy/eks/terraform`. Variables: `demo.tfvars`, `backend.hcl`.

**B1. Initialise and check**

```bash
cd deploy/eks/terraform
terraform init -backend-config=backend.hcl
terraform fmt -check && terraform validate && terraform test
```

Expected: `Success! The configuration is valid.` and `5 passed, 0 failed`.
Failure: `S3 bucket does not exist` → create the state bucket (versioning on, public access
blocked) first; `AccessDenied` on the lockfile → grant `s3:PutObject/DeleteObject` on `<key>.tflock`.

**B2. Plan and apply**

```bash
terraform plan -var-file=demo.tfvars -out=eks.tfplan
terraform show eks.tfplan | less          # review: VPC, 1 NAT, EKS 1.36, node group, IAM roles, 11 ECR repos
terraform apply eks.tfplan
```

Expected: apply completes in roughly 15–25 minutes (EKS control plane and node group dominate).
Verify:

```bash
terraform output
aws eks describe-cluster --name "$(terraform output -raw cluster_name)" --query cluster.status --output text   # ACTIVE
```

Failures and recovery:
- `RepositoryAlreadyExistsException` (ECR) → the names exist in this account (for example from
  `infrastructure/`). Set `manage_ecr_repositories = false` to reuse them, or change
  `ecr_repository_prefix`, then plan again.
- `UnsupportedAvailabilityZoneException` → pick other AZs in `availability_zones`.
- Node group `CREATE_FAILED` with `NodeCreationFailure` → usually vCPU quota or an instance type
  unavailable in an AZ; adjust `system_node_instance_types` and re-apply.

**B3. Push images (GitHub Actions or locally)**

With `github_repository` set, put `terraform output -raw github_ecr_push_role_arn` in your fork's
workflow (`aws-actions/configure-aws-credentials` with `role-to-assume`) and push to the branch.
Locally (ARM64 host or buildx with QEMU):

```bash
REG=$(terraform -chdir=deploy/eks/terraform output -raw ecr_registry); TAG=$(git rev-parse --short=12 HEAD)
aws ecr get-login-password | docker login --username AWS --password-stdin "$REG"
for s in ai-gateway cart-service catalogue-service currency-service kafka-bridge mcp-server moks payment-service user-service web; do
  docker buildx build --platform linux/arm64 -t "$REG/roboshop-$s:$TAG" --push "services/$s"; done
docker buildx build --platform linux/arm64 -t "$REG/roboshop-shipping:$TAG" --push services/shipping-service
```

Set `IMAGE_TAG=$TAG` in the env file. Verify:
`aws ecr describe-images --repository-name roboshop-web --image-ids imageTag=$TAG`.
Failure: `tag invalid: ... already exists` → tags are immutable; build a new commit.

---

## C. Cluster access and storage

**C1. kubeconfig**

```bash
$(terraform -chdir=deploy/eks/terraform output -raw kubeconfig_command)
kubectl get nodes -L roboshop.dev/pool,kubernetes.io/arch
```

Expected: 2 `Ready` arm64 nodes with `roboshop.dev/pool=system`.
Failure: `the server has asked for the client to provide credentials` → your identity is not in
`admin_principal_arns` and `enable_cluster_creator_admin` is false; add it and re-apply.
Timeout → your IP changed; update `api_public_access_cidrs`.

**C2. Add-ons**

```bash
aws eks list-addons --cluster-name roboshop-demo --output text
kubectl -n kube-system get ds aws-node -o jsonpath='{.spec.template.spec.containers[*].name}'   # includes aws-eks-nodeagent
kubectl -n kube-system get pods -l app.kubernetes.io/name=aws-ebs-csi-driver
```

Expected: five add-ons `ACTIVE`; the network policy agent container present (NetworkPolicy
enforcement depends on it).

---

## D. Controllers, CRDs and secrets

**D1. Platform controllers**

```bash
deploy/eks/platform/install.sh deploy/eks/env/roboshop-demo.env
```

Installs, in order: Karpenter, AWS Load Balancer Controller, cert-manager, External Secrets,
kube-prometheus-stack (then Karpenter again with its ServiceMonitor), Istio base/istiod/CNI/ingress
gateway, Gatekeeper, KEDA, Jaeger + OTel agent, Argo CD. Each `helm upgrade --install --wait`.
Re-run with one component name to retry only that one (for example `... install.sh <env> istio`).

Expected: `Platform ready.` Verify:

```bash
helm list -A
kubectl get pods -A -o wide | grep -v Running | grep -v Completed     # nothing pending/crashing
kubectl -n istio-ingress get svc istio-ingressgateway                   # EXTERNAL-IP is an *.elb.* hostname
```

Failures:
- Istio ingress gateway pods `Pending` → Karpenter has no NodePools yet; continue with D2 (the
  `--wait` for that release can time out on the very first run; re-run `install.sh <env> istio`
  after D2).
- LBC events `AccessDenied` → the Pod Identity association is missing: `aws eks
  list-pod-identity-associations --cluster-name <name>`; re-apply Terraform.

**D2. Render the layers and apply the platform layers**

```bash
deploy/eks/scripts/render.sh deploy/eks/env/roboshop-demo.env
git add deploy/eks/clusters/roboshop-demo && git commit -m "Render roboshop-demo" && git push   # your fork
```

Argo CD route (recommended):

```bash
kubectl apply -f deploy/eks/clusters/roboshop-demo/argocd/manifests.yaml
kubectl -n argocd get applications -w
```

Without Argo CD, apply the same files in this order with
`kubectl apply --server-side -f deploy/eks/clusters/roboshop-demo/<layer>/manifests.yaml`:
`platform`, `karpenter`, `secrets`, `tls`, `gatekeeper`, `istio`, `observability`, then E–I.

Expected: `roboshop-platform`, `-karpenter`, `-secrets`, `-tls` `Synced/Healthy`; NodePools
`general` and `spot` `Ready`. Verify: `kubectl get nodepools,ec2nodeclasses`.
Failure: EC2NodeClass `Ready=False` with role errors → `KARPENTER_NODE_ROLE` must equal
`terraform output -raw karpenter_node_role_name`; re-render.

**D3. Secrets**

```bash
deploy/eks/scripts/put-secrets.sh deploy/eks/env/roboshop-demo.env     # prompts for the super admin
kubectl -n roboshop-ai get externalsecret                                # SecretSynced / Ready=True
```

Optional Razorpay test keys and Turnstile keys are read from environment variables of the same
names when you run the script. Failure: `AccessDeniedException` in the ExternalSecret status →
the secret name must be `<SECRETS_PREFIX>/<ENVIRONMENT>/app`, matching `secrets_prefix` and
`environment` in Terraform.

---

## E. Data services and explicit migrations

**E1. Apply applications with the data stores** (Argo CD syncs `roboshop-apps` automatically at
wave 1; without Argo apply `apps`). Data stores start first in practice because applications
retry until their dependencies are ready.

```bash
kubectl -n roboshop-ai get pvc                     # all Bound (gp3-encrypted), each in one AZ
kubectl -n roboshop-ai rollout status sts/mongodb sts/rabbitmq sts/kafka --timeout=10m
kubectl -n roboshop-ai rollout status deploy/shipping-db deploy/redis --timeout=10m
```

Failure: PVC `Pending` with `WaitForFirstConsumer` → normal until the pod schedules; if the pod
is also Pending, check `kubectl describe pod` for Karpenter limits or quota.

**E2. Shipping schema** — migrations run inside shipping-service/shipping-worker at start-up,
serialized by a PostgreSQL advisory lock. Confirm explicitly:

```bash
kubectl -n roboshop-ai exec deploy/shipping-db -- psql -U shipping -d shipping -c 'SELECT version, applied_at FROM public.shipping_migrations ORDER BY version'
```

Expected: versions 1 and 2.

**E3. Location seed (one-off Job)**

```bash
kubectl apply --server-side -f deploy/eks/clusters/roboshop-demo/jobs/manifests.yaml
kubectl -n roboshop-ai wait job/shipping-location-import --for=condition=Complete --timeout=10m
```

Failure: Job fails with duplicate keys → it already ran; the seed is not idempotent by design.

**E4. Order ledger.** The demo profile keeps `COMMERCE_BACKEND=json` (one gateway replica, PVC);
no migration. For PostgreSQL, follow README.md#demo-profile-versus-production and
`docs/deployment/postgres-commerce-migration.md` before scaling the gateway.

**Backups before you continue:** the demo stores have no automatic backups. If you put anything
you care about in it, create EBS snapshots first (K1).

---

## F. Istio and policy audit rollout

The first render used `MTLS_MODE=PERMISSIVE`, `AUTHZ_DRY_RUN=true`, `POLICY_ACTION=dryrun`.

**F1. Mesh enrollment**

```bash
deploy/eks/scripts/verify.sh deploy/eks/env/roboshop-demo.env | grep istio-proxy
istioctl proxy-status   # optional; every roboshop-ai app pod SYNCED
```

**F2. Policy audit** — Gatekeeper templates (wave 0) and constraints (wave 2) are applied in
`dryrun`. Wait one audit interval (60 s), then:

```bash
kubectl get constraints -o custom-columns=NAME:.metadata.name,ACTION:.spec.enforcementAction,VIOLATIONS:.status.totalViolations
kubectl get roboshoprestricted restricted-pods -o jsonpath='{range .status.violations[*]}{.name}: {.message}{"\n"}{end}'
```

Expected: 0 violations (the offline pre-check reported 0). Fix or deliberately except anything
listed; never widen a constraint's scope to make it pass.

**F3. NetworkPolicy check** *(runtime check)*: after `roboshop-apps` syncs, all pods must stay
`Ready`. If probes fail, check the policy agent logs
(`kubectl -n kube-system logs ds/aws-node -c aws-eks-nodeagent`) before changing policies.

**F4. Authorization dry run** *(runtime check)*: exercise the shop (browse, sign in, add to cart,
test checkout, open the assistant), then look for would-be denials:

```bash
for p in $(kubectl -n roboshop-ai get pods -l 'app,!sidecar.istio.io/inject' -o name); do
  istioctl proxy-config log "${p#pod/}.roboshop-ai" --level rbac:debug >/dev/null; done
# ... use the shop for a few minutes, then:
kubectl -n roboshop-ai logs -l 'app,!sidecar.istio.io/inject' -c istio-proxy --since=15m | grep -i 'shadow denied'
```

Dry-run decisions are logged only at the `rbac` debug level (reset with `--level rbac:warning`).

Each line names a caller and callee; add the missing edge to `k8s/istio/authorization.yaml` only
if the code really makes that call.

**F5. Tighten** — set in the env file, re-render, commit, push:

```bash
MTLS_MODE=STRICT
AUTHZ_DRY_RUN=false
POLICY_ACTION=deny
```

Verify: `kubectl -n roboshop-ai get peerauthentication default -o jsonpath='{.spec.mtls.mode}'`
→ `STRICT`; `curl -fsS https://<host>/api/ready` still succeeds.
Rollback: set the three values back and re-render; Argo CD reverts within one sync.

---

## G. Application build, push and deployment

New release = new commit SHA:

```bash
# B3 for the changed services, then
sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=<new-sha>/" deploy/eks/env/roboshop-demo.env
deploy/eks/scripts/render.sh deploy/eks/env/roboshop-demo.env
git diff deploy/eks/clusters/roboshop-demo/apps     # only image digests should change
git commit -am "Deploy <new-sha>" && git push
kubectl -n roboshop-ai rollout status deploy --timeout=10m
```

Failure: `no image roboshop-<svc>:<sha>` from render → that service was not built for this SHA;
build it (B3) or keep the previous tag for it (render uses one tag for all services).

---

## H. DNS, TLS and public ingress

**H1. DNS** — point your hostname at the NLB:

```bash
NLB=$(kubectl -n istio-ingress get svc istio-ingressgateway -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "$NLB"
```

Create a Route 53 **alias A** record (or a CNAME) for `<PUBLIC_HOST>` → `$NLB`. Verify:
`dig +short <PUBLIC_HOST>` returns the NLB addresses.

**H2. Staging certificate**

```bash
kubectl -n istio-ingress get certificate roboshop -w      # READY True (staging issuer)
```

Failure: `Waiting for DNS-01 challenge propagation` for > 10 min → check
`kubectl -n cert-manager logs deploy/cert-manager | grep -i route53`; `AccessDenied` means
`route53_zone_id` in Terraform is not the zone that holds `<PUBLIC_HOST>`.

**H3. Production certificate** — set `CERT_ISSUER=letsencrypt-prod`, re-render, push; the
Certificate re-issues. Then:

```bash
curl -sSI https://<PUBLIC_HOST>/ | head -1                 # HTTP/2 200
curl -sS -o /dev/null -w '%{http_code}\n' http://<PUBLIC_HOST>/   # 301
deploy/eks/scripts/verify.sh deploy/eks/env/roboshop-demo.env
```

*(runtime check)* Client IP: the ingress gateway access log (`kubectl -n istio-ingress logs
deploy/istio-ingressgateway | tail -1`) should show your public IP, not an NLB address. If
requests hang or return 400, proxy protocol is enabled on one side only: both the Service
annotation and the pod `gatewayTopology.proxyProtocol` must be present.

---

## I. KEDA and Karpenter activation

**I1. RabbitMQ monitoring user for KEDA** (once, after RabbitMQ is ready). The password comes from
the synced Secret through stdin and is never shown:

```bash
kubectl -n roboshop-ai get secret roboshop-secrets -o jsonpath='{.data.RABBITMQ_KEDA_PASSWORD}' | base64 -d \
  | kubectl -n roboshop-ai exec -i sts/rabbitmq -- rabbitmqctl add_user keda
kubectl -n roboshop-ai exec sts/rabbitmq -- rabbitmqctl set_user_tags keda monitoring
kubectl -n roboshop-ai exec sts/rabbitmq -- rabbitmqctl set_permissions -p / keda '^$' '^$' '^$'
```

*(runtime check)* `rabbitmqctl add_user` reads the password from standard input when it is not an
argument; if your RabbitMQ version rejects that, run `rabbitmqctl add_user keda` interactively.

**I2. ScaledObject** — synced by `roboshop-keda` (wave 2). Verify:

```bash
kubectl -n roboshop-ai get scaledobject shipping-worker     # READY True, ACTIVE False when the queue is empty
kubectl -n roboshop-ai get hpa                              # only keda-hpa-shipping-worker targets shipping-worker
```

Failure: `READY False` with `401` → I1 not done or the password differs; `connection refused` →
NetworkPolicy `rabbitmq-clients` must allow namespace `keda` on 15672.

**I3. Controlled backlog test** (throwaway queue and Deployment; real orders are not touched):

```bash
deploy/eks/scripts/backlog-test.sh deploy/eks/env/roboshop-demo.env 60
```

Expected sequence in the output: replicas rise from 0 towards 6, some pods `Pending`, new
NodeClaims appear (Spot or On-Demand, arm64), pods become Ready. The script deletes the queue and
namespace on exit; Karpenter consolidates the extra nodes about 5 minutes later
(`kubectl get nodeclaims -w`).

Scale-to-zero note: `shipping-worker` keeps `minReplicaCount: 1` because a Java cold start plus
migrations delays the first paid order. Set it to 0 only if that latency is acceptable.

---

## J. Observability

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80   # Grafana
kubectl -n monitoring get secret kube-prometheus-stack-grafana -o jsonpath='{.data.admin-password}' | base64 -d | pbcopy  # copies, never prints
kubectl -n observability port-forward svc/jaeger 16686:16686                    # Jaeger UI
```

Checks:
- Prometheus → Status → Targets: `podMonitor/monitoring/roboshop-mesh` targets up for every app pod.
- Alerts loaded: `kubectl -n monitoring get prometheusrule roboshop`.
- Logs: CloudWatch Logs → `/roboshop/<cluster>/containers`, one stream per pod.
- Control plane: `/aws/eks/<cluster>/cluster` with `kube-apiserver-audit-*` streams.

**Example investigation: a failed checkout.**
1. Alert `RoboShopHighErrorRatio` names `destination_workload=ai-gateway`.
2. Grafana → Explore → Prometheus: `sum by (response_code) (rate(istio_requests_total{destination_workload="payment-service"}[5m]))`
   shows whether payment-service is returning 5xx.
3. CloudWatch Logs Insights on the container log group:
   `fields @timestamp, log | filter log like /payment/ and log like /"level":"ERROR"/ | sort @timestamp desc | limit 20`
   and copy the `traceId`.
4. Jaeger → search by trace ID: the span tree shows ingress → web → ai-gateway → payment-service
   → (Razorpay HTTP span). A Razorpay timeout appears as a long client span; a missing test key
   appears as an immediate error in payment-service.
5. For an AI request, the same trace continues into `moks` with `rag.retrieve` and the provider
   span; with no provider configured the reply is "Please connect an LLM", which is expected.

Telemetry is best-effort: the collector queues and retries, and an unavailable Jaeger or
CloudWatch drops telemetry, not requests.

---

## K. Rollback and cleanup

**Application rollback**

```bash
git revert <deploy-commit> && git push        # Argo CD re-syncs the previous digests
# or immediately, then fix Git:
kubectl -n roboshop-ai rollout undo deploy/<name>
```

**Controller rollback**: set the previous version in `platform/versions.env` and re-run
`install.sh <env> <component>`; Helm keeps history (`helm history <release> -n <ns>`).

**Policy/mesh rollback**: F5 in reverse (`dryrun`, `PERMISSIVE`, `AUTHZ_DRY_RUN=true`).

### Teardown (explicit, in this order)

**K1. Back up what you want to keep** (data stores are single volumes):

```bash
for pvc in $(kubectl -n roboshop-ai get pvc -o jsonpath='{.items[*].spec.volumeName}'); do
  vol=$(kubectl get pv "$pvc" -o jsonpath='{.spec.csi.volumeHandle}')
  aws ec2 create-snapshot --volume-id "$vol" --description "roboshop $pvc before teardown" --query SnapshotId --output text
done
```

Snapshots keep billing until you delete them.

**K2. Stop Argo CD from recreating things**

```bash
kubectl -n argocd delete applications --all
```

**K3. Remove the public endpoint** (lets the controller delete the NLB and its security group
before the VPC goes):

```bash
helm -n istio-ingress uninstall istio-ingressgateway
kubectl -n istio-ingress get svc   # gone; wait until the NLB disappears from the EC2 console
```

**K4. Remove workloads, then Karpenter capacity**

```bash
kubectl delete ns roboshop-ai keda-backlog-test --ignore-not-found --wait
kubectl delete nodepools --all            # Karpenter drains and terminates its nodes
kubectl get nodeclaims                    # wait until empty
```

**K5. Delete data volumes — separate, deliberate step.** The StorageClass uses `Retain`, so
deleting PVCs/namespaces does **not** delete EBS volumes:

```bash
kubectl get pv -o custom-columns=PV:.metadata.name,CLAIM:.spec.claimRef.name,STATUS:.status.phase,VOLUME:.spec.csi.volumeHandle
kubectl delete pv <pv-name>                                    # Kubernetes object only
aws ec2 delete-volume --volume-id <vol-id>                     # the data; irreversible
```

**K6. Destroy the infrastructure**

```bash
cd deploy/eks/terraform
terraform plan -destroy -var-file=demo.tfvars -out=destroy.tfplan
terraform apply destroy.tfplan
```

Failure: VPC deletion `DependencyViolation` → an NLB, ENI or security group created by a
controller still exists (K3/K4 skipped); delete it and re-run. ECR repositories have
`force_delete = false`: delete images first (`aws ecr batch-delete-image`) or remove them from
state if you intend to keep them. The secret is deleted immediately for `environment = "demo"`
(no recovery window).

**K7. Leftovers to check**: EBS snapshots (K1), CloudWatch log groups (deleted by Terraform),
the Route 53 record (H1), the state bucket.
