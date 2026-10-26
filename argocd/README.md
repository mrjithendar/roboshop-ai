# mk4 Argo CD applications

All Application and AppProject YAML lives in this root directory. Workload
sources remain in `services/` and `minikube/`. `kustomization.yaml` registers
34 Applications and three projects; it does not include workload manifests.
Argo CD and Traefik controllers are deliberately excluded. Their existing Helm
releases, CRDs and installation scripts remain externally managed. OpenClaw's
read-only observer Role/RoleBinding in `argocd` is still owned by OpenClaw.

## Register the catalog

Validate with `python3 scripts/argocd/validate.py --external-charts`.
Review, commit and push the catalog and workload changes before registering
Applications from `argocd/kustomization.yaml` with kubectl in the intended
context. Review each Application in Argo CD before syncing. The bootstrap shell
wrapper has been removed; existing Applications remain unchanged.

New Applications have **manual sync**, no deletion finalizers, no automatic
pruning and `FailOnSharedResource=true`. Registering them does not adopt or
restart their workloads. OpenClaw retains its existing automatic/self-heal
policy. Review each Application's diff and prerequisites, then sync it without
pruning in Argo CD. Applications can be OutOfSync until that review and sync.
Do not enable Force/Replace to resolve an immutable-field difference.

## Ownership

| Applications | Sources and migration notes |
| --- | --- |
| ai-gateway, cart-service, catalogue-service, currency-service, frontend, jaeger, kafka-bridge, mcp-server, moks, nginx, otel-collector, payment-service, postgres, rabbitmq, redis, shipping-service, sre-copilot, user-service | Only the named `services/<service>/*-minikube.yaml` file is loaded. `postgres` owns shipping-db; `kafka-bridge` owns the Kafka StatefulSet and bridge sidecar. |
| roboshop-config | Shared ConfigMap, namespace and shop ingress; one owner for shared configuration. |
| mongodb | Existing Deployment, Service and PVC baseline; **not** the repo's newer StatefulSet. A controller conversion needs a separate data migration. |
| shopping-agent, product-ingestion | Existing legacy Deployment and Service baselines; not deleted or silently replaced by moks. |
| coredns, kube-proxy, kindnet | Current mk4 Deployment/DaemonSets, configuration and supporting RBAC. Cluster-specific baselines, not portable installers. Kubernetes' built-in system:node-proxier ClusterRole remains Kubernetes-owned. |
| cert-manager, metrics-server, grafana | Pinned upstream Helm charts with Git-hosted values and existing release names. |
| roboshop-letsencrypt, prometheus, wordpress | Existing local charts and release names. WordPress ingress remains enabled for the existing initialized site. |
| shared-tls | The single existing TLSStore in jithendar; no duplicate certificate or Traefik controller. WordPress owns the canonical Certificate. |
| openclaw | Existing private overlay, unchanged workload identity and sync behavior. |
| jfrog | Optional, currently absent. Manual sync only, requires bootstrap credentials, storage and host-capacity checks first. Public ingress remains a separate explicit exposure step. |

Langfuse is a cloud integration and n8n has no deployment manifests, so neither
has an empty/fictitious Application. The checked-in workload inventory records
all observed Deployment/StatefulSet/DaemonSet identities except Argo CD and
Traefik; full validation checks that every identity is covered.

## First-sync review

1. Preserve existing Secrets and PVCs. Credentials remain external; no credential values are copied into this catalog.
   JFrog alone renders a configuration-only Secret in its dedicated project;
   its actual passwords and keys reference the external bootstrap Secret. Check `roboshop-secrets`, `ecr-pull`,
   `wordpress-credentials`, `monitoring-auth` and OpenClaw's existing credentials.
   Continue ECR credential refresh independently of workload reconciliation.
2. Review shared configuration and infrastructure first, then data services,
   then application services. Existing Helm resources keep their release names.
   Argo renders Helm templates; it does not continue Helm release history.
3. Compare desired/live images, selectors, replicas, PVC names/sizes, endpoints
   and ConfigMaps. Repository service definitions may differ from running pods;
   first sync can roll workloads. Back up stateful data before such changes.
4. For CoreDNS/kube-proxy/kindnet, use a cluster maintenance window and review
   **every diff**. Minikube/kubeadm may also reconcile these resources. Keep
   self-heal disabled until their ownership and upgrade process is coordinated;
   do not use the legacy cluster installer to reapply them after adoption.
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
