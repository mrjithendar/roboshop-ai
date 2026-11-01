# roboshop-demo EKS Argo CD applications

Argo CD runs on mk4 and manages the `roboshop-demo` EKS cluster as a remote cluster, so these
Applications live in mk4's `argocd` namespace with `destination.name: roboshop-demo`. They are named
`roboshop-demo-<app>` because that namespace also holds mk4's own platform Applications.

They use manual sync, no finalizers, and must never be synced with prune.

## Scope

| Applications | Source |
| --- | --- |
| cart-service, catalogue-service, currency-service, mcp-server, moks, payment-service, shipping-service, user-service, web | The `services/<service>` manifests with a mesh ServiceAccount set by an inline Kustomize patch. |
| ai-gateway | The same, with its Service port declared as TCP. |
| kafka-bridge, postgres, rabbitmq | The same manifests with the sidecar turned off. |
| redis | The `services/redis` manifests with the sidecar turned off. |
| mongodb | The StatefulSet in `apps/data`, plus the catalog ConfigMap. |
| roboshop-config | Namespace and ConfigMap in `apps/roboshop`. |
| mesh | ServiceAccounts, PeerAuthentication and AuthorizationPolicies in `apps/mesh`. |
| storage | The default `gp3-encrypted` StorageClass. |

Ingress and TLS live in `tools/eks` ([README](https://github.com/mrjithendar/tools/blob/master/eks/README.md));
Applications here only reference the ServiceAccounts. The `deploy/eks/k8s/argocd` layers are a
different design that needs Gatekeeper, Karpenter and External Secrets, which this cluster does not run.

## Prerequisites

- **EBS CSI driver.** The `aws-ebs-csi-driver` add-on, which `tools/infrastructure` does not install
  yet. Without it, the PVCs for mongodb, postgres, rabbitmq, kafka and ai-gateway stay Pending.
- **`roboshop-secrets`.** Argo CD does not manage Secrets. After the namespace exists, from the tools
  checkout: `python3 scripts/argocd/bootstrap.py --app-secrets-only --context roboshop-demo`. External
  values such as Razorpay, SES and Turnstile are set separately.
- **Git.** Every source is read from `master`, so these changes must be merged before syncing.

Nodes pull from ECR with their node role, so the manifests set no image pull secret.

## Deploy

```bash
kubectl --context mk4 apply -k argocd-eks
argocd app sync argocd/roboshop-demo-storage argocd/roboshop-demo-roboshop-config
# create roboshop-secrets, then:
argocd app sync argocd/roboshop-demo-mongodb argocd/roboshop-demo-postgres argocd/roboshop-demo-rabbitmq \
  argocd/roboshop-demo-redis argocd/roboshop-demo-kafka-bridge
argocd app sync --project eks
```

`tools/scripts/argocd/deploy.py` only deploys to the local cluster, so it does not read this catalog.
