## Fresh-cluster sequence

```bash
./bootstrap-cluster.sh --dry-run
./bootstrap-cluster.sh --context mk4
./deploy-argocd.sh
```

Or run both stages with `./bootstrap-cluster.sh --deploy-apps`.
Bootstrap installs **cert-manager → Traefik → Argo CD**, waits for controller
readiness, then applies the Argo CD ingress. It uses pinned HTTPS Helm charts,
works from a Mac client or Linux host, and preserves existing deployed releases.
It does not install host tools or upgrade existing releases. Failures stop the
sequence. Application secrets, images and storage remain prerequisites.

Cert-manager is now Helm-bootstrap-owned and excluded from the default Argo
catalog. On older clusters with a `cert-manager` Argo Application, bootstrap syncs that
existing application instead of installing a competing Helm release. This also
repairs partial installations while preserving their existing ownership.
Do not use cascading deletion or delete cert-manager CRDs/certificates.

On the Minikube Linux host, expose Traefik ports separately:
`PROFILE=mk4 bash minikube/expose-ingress.sh`. Allow host ports 80/443 and point
DNS at the host. Then deploy the issuer and certificate sources in order:
`./deploy-argocd.sh roboshop-letsencrypt`, `./deploy-argocd.sh wordpress`,
`./deploy-argocd.sh shared-tls`. The WordPress chart currently owns the canonical
certificate; bootstrap does not claim that trusted public TLS is already ready.

# mk4 Argo CD applications

All Application and AppProject YAML lives in this root directory. Workload
sources remain in `services/` and `minikube/`. `kustomization.yaml` registers
31 Applications and three projects; it does not include workload manifests.
Argo CD and Traefik controllers are deliberately excluded. Their existing Helm
releases, CRDs and installation scripts remain externally managed.

## Simple deployment commands

On a new cluster, `./deploy-argocd.sh` automatically installs the missing
controller before deploying applications (requires Kubernetes Helm). No separate
install command is needed. Controller-only installation remains available:

```bash
./deploy-argocd.sh install --dry-run
./deploy-argocd.sh install --context mk4
```

This downloads pinned Argo CD chart 10.10.5 from the official HTTPS Helm
repository (`https://argoproj.github.io/argo-helm`), avoiding OCI registry
credential helpers and leaving Docker credentials unchanged. It uses `minikube/argocd/values.yaml`
and waits for installation and CRDs. Repeat runs reuse a deployed Helm release
without changing its version or values. Failed releases and unmanaged existing
CRDs require inspection rather than automatic adoption. The explicit `install` command installs no catalog applications. Automatic
installation continues with the selected applications. Neither installation path
creates credentials, Traefik, certificates, or public ingress. `status`, `list`,
`--help`, and `--dry-run` never install the controller.

From the repository root (requires `kubectl`, Python 3 and PyYAML):

```bash
./deploy-argocd.sh                # Deploy every Application in the Argo CD catalog
./deploy-argocd.sh list
./deploy-argocd.sh roboshop --dry-run
./deploy-argocd.sh roboshop
./deploy-argocd.sh frontend nginx
./deploy-argocd.sh status
```

The default context is `mk4`; use `--context NAME` or `KUBE_CONTEXT` to change it.
The script creates missing projects and Applications, requests a sync without
pruning, and waits up to 600 seconds for Synced/Healthy (`--timeout 900` overrides
this). Existing Application settings, are preserved.
Commit and push workload changes first: Argo CD deploys the configured Git
revision, not uncommitted local workload files.

With no arguments, or with `all`, the script selects every Application registered
in `argocd/kustomization.yaml`, including infrastructure, JFrog and
legacy apps. Referenced AppProjects are created when missing. Existing Secrets,
images and storage remain prerequisites; missing dependencies cause the health
wait to fail rather than silently skipping an app.

Use `roboshop` for just the current shop services and shared configuration,
excluding legacy apps and data/messaging infrastructure.
Use `./deploy-argocd.sh --dry-run` to preview the complete selection.

## Register the catalog

Validate with `python3 scripts/argocd/validate.py --external-charts`.
Review, commit and push the catalog and workload changes before registering
Applications from `argocd/kustomization.yaml` with kubectl in the intended
context. Review each Application in Argo CD before syncing. The bootstrap shell
wrapper has been removed; existing Applications remain unchanged.

New Applications have **manual sync**, no deletion finalizers, no automatic
pruning and `FailOnSharedResource=true`. Registering them does not adopt or
restart their workloads. Review each Application's diff and prerequisites, then sync it without
pruning in Argo CD. Applications can be OutOfSync until that review and sync.
Do not enable Force/Replace to resolve an immutable-field difference.

## Ownership

| Applications | Sources and migration notes |
| --- | --- |
| ai-gateway, cart-service, catalogue-service, currency-service, frontend, jaeger, kafka-bridge, mcp-server, moks, nginx, otel-collector, payment-service, postgres, rabbitmq, redis, shipping-service, user-service | Only the named `services/<service>/*-minikube.yaml` file is loaded. `postgres` owns shipping-db; `kafka-bridge` owns the Kafka StatefulSet and bridge sidecar. |
| roboshop-config | Shared ConfigMap, namespace and shop ingress; one owner for shared configuration. |
| mongodb | Existing Deployment, Service and PVC baseline; **not** the repo's newer StatefulSet. A controller conversion needs a separate data migration. |
| shopping-agent | Retired from the active catalog; functionality resides in Moks. Historical adoption files do not make it a required workload. |
| cert-manager, metrics-server, grafana | Pinned upstream Helm charts with Git-hosted values and existing release names. |
| roboshop-letsencrypt, prometheus, wordpress | Existing local charts and release names. WordPress ingress remains enabled for the existing initialized site. |
| shared-tls | The single existing TLSStore in jithendar; no duplicate certificate or Traefik controller. WordPress owns the canonical Certificate. |
| jfrog | Optional, currently absent. Manual sync only, requires bootstrap credentials, storage and host-capacity checks first. Public ingress remains a separate explicit exposure step. |

Langfuse is a cloud integration and n8n has no deployment manifests, so neither
has an empty/fictitious Application. The checked-in workload inventory records
managed Deployment/StatefulSet/DaemonSet identities, excluding Argo CD,
Traefik, CoreDNS, kube-proxy and kindnet; full validation checks that every identity is covered.

## First-sync review

1. Preserve existing Secrets and PVCs. Credentials remain external; no credential values are copied into this catalog.
   JFrog alone renders a configuration-only Secret in its dedicated project;
   its actual passwords and keys reference the external bootstrap Secret. Check `roboshop-secrets`, `ecr-pull`,
   `wordpress-credentials`, `monitoring-auth`.
   Continue ECR credential refresh independently of workload reconciliation.
2. Review shared configuration and infrastructure first, then data services,
   then application services. Existing Helm resources keep their release names.
   Argo renders Helm templates; it does not continue Helm release history.
3. Compare desired/live images, selectors, replicas, PVC names/sizes, endpoints
   and ConfigMaps. Repository service definitions may differ from running pods;
   first sync can roll workloads. Back up stateful data before such changes.
4. CoreDNS, kube-proxy and kindnet remain cluster-managed. They are excluded
   from this catalog and its managed-workload inventory.
5. Stop imperative Helm upgrades and kubectl deployment scripts for adopted
   workloads. CI builds/pushes images; desired image changes go through Git.
   The legacy deploy workflow and service/Helm deployment scripts have been removed.
   Argo CD and Traefik are the intentional exception. Do not uninstall the old
   Helm releases: uninstalling would delete the adopted workload resources.
6. Check health after each manual sync. Only consider enabling automatic sync
   per Application after its first adoption is healthy. Pruning is a separate
   decision; do not prune persistent data or cluster networking resources.

The adoption baselines in `minikube/gitops/adoption/` omit server metadata,
status, last-applied annotations and Secret resources. They preserve live
selectors, images, service allocations and node-specific configuration. Future
changes to those workloads must edit these baselines, not regenerate them from
live state or update the alternative MongoDB StatefulSet definition.

Removing an Application from this catalog does not delete it from the cluster;
review removal explicitly. Without cascading finalizers, deleting an Application
leaves its workloads running. To return a workload to imperative management,
remove its Argo ownership first and verify no Application still reconciles it.

Optional ELK logging is staged separately to preserve deployment ordering and avoid
adding a collector during `deploy all`. See [ELK deployment](../observability/elk/README.md):
`project-elk.yaml`, then (only if no existing ECK) `elk-operator.yaml`, then
`elk-core.yaml`, then `elk-pipeline.yaml`. Namespace `elk`, Kibana at `/elk`.


The required workload inventory (`minikube/gitops/workload-inventory.json`) covers
only the active default catalog. Retired product-ingestion/shopping-agent deployments are excluded. Enabling optional apps
requires reviewing their project, ownership and inventory together. Validation still
fails when any required active workload is absent; it never filters expected entries
against whatever happened to render. This inventory change does not delete live pods.

### Interrupted Argo CD Helm installation

An interrupted Helm client can leave revision 1 in `pending-install` while the
controllers run normally. Bootstrap accepts this state only after rollout checks
for server, repository server, Redis and application controller, followed by CRD
checks. It does not mark Helm deployed, delete Helm Secrets, or reinstall the
controller. Pending upgrades/rollbacks and failed releases still stop bootstrap.
Inspect `helm --kube-context mk4 -n argocd history argocd` before any later Helm
upgrade; reuse of healthy workloads does not repair Helm release metadata.

### Namespace creation before sync

`deploy-argocd.sh` applies the selected applications' destination Namespace
manifests from `minikube/namespaces/` before creating projects or requesting
syncs. It deduplicates namespaces and uses minimal server-side manifests to
preserve existing labels and annotations. It never deletes or prunes namespaces.
Existing Application destination settings are respected; unknown or remote
destinations stop before namespace changes. Preview/list/status remain read-only.
`CreateNamespace=true` is also retained in Argo sync options as a second safeguard.

### ECR pull credentials

Bootstrap requires an authenticated AWS CLI and refreshes `ecr-pull` in the
repository-managed namespaces (excluding kube-system). Defaults: region
`us-east-1`, registry `881026659929.dkr.ecr.us-east-1.amazonaws.com`; override
with `AWS_REGION` and `ECR_REGISTRY`. AWS credentials need
`ecr:GetAuthorizationToken` and repository pull permissions. Tokens are sent to
kubectl over stdin, never printed or stored in Git. App credentials in
`roboshop-secrets` are not created or changed.

Default ServiceAccounts receive the pull-secret reference, preserving other
references. Existing explicit workload references continue to work. Custom
ServiceAccounts must reference it themselves. There is no cluster-wide Secret;
new unmanaged namespaces are not covered. Tokens expire after 12 hours; refresh:

```bash
./bootstrap-cluster.sh --pull-secrets-only --context mk4
```

Manual refresh does not restart existing pods. To install the optional six-hour
CronJob, run `./bootstrap-cluster.sh --pull-secrets-only --schedule-pull-secrets`.
See [scheduled ECR refresh](../minikube/ecr-refresh/README.md) for the required
in-cluster AWS credentials, permissions, verification, and suspension commands.

### Fresh application credentials

Normal bootstrap now creates `roboshop-ai/roboshop-secrets` if absent, with
random database passwords, service tokens, a Fernet encryption key, and the
superadmin email `team@jithendar.com` plus a random password. Existing Secrets
are preserved; partial Secrets require restoration rather than silent rotation.
For an already deployed fresh cluster, run:

```bash
./bootstrap-cluster.sh --app-secrets-only
```

This requires only kubectl, not AWS. It never prints credentials or writes them
to Git. Back up the Secret securely. Do not use newly generated passwords with
restored databases: restore their original Secret/encryption key instead.
External Razorpay, SES, Turnstile, AWS and Langfuse values are not fabricated;
configure them separately. Scheduled ECR refresh still requires AWS credentials.
