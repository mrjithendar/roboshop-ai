# roboshop-demo EKS Argo CD applications

Argo CD runs on mk4 and manages the `roboshop-demo` EKS cluster as a remote cluster, so these
Applications live in mk4's `argocd` namespace with `destination.name: roboshop-demo`. They are named
`roboshop-demo-<app>` because the mk4 catalog (`../argocd-minikube`) shares that namespace: an
Application with the same name would retarget the mk4 workload.

Like mk4, they use manual sync, no finalizers, and must never be synced with prune.

## Scope

| Applications | Source |
| --- | --- |
| cart-service, catalogue-service, currency-service, mcp-server, moks, payment-service, redis, shipping-service, user-service, web | The `services/<service>` manifests, unchanged. |
| ai-gateway, kafka-bridge, postgres, rabbitmq | The same manifests with the mk4 `nodeSelector` removed by an inline Kustomize patch. |
| mongodb | The StatefulSet in `apps/data`, plus the catalog ConfigMap from tools. |
| roboshop-config | Namespace and ConfigMap from tools. |
| storage | The default `gp3-encrypted` StorageClass. |

There is no ingress: nothing here is reachable from outside the cluster. The `deploy/eks/k8s/argocd`
layers are a different design that needs Istio, Gatekeeper, Karpenter and External Secrets, none of
which this cluster runs.

## Prerequisites

- **EBS CSI driver.** The `aws-ebs-csi-driver` add-on, which `tools/infrastructure` does not install
  yet. Without it, the PVCs for mongodb, postgres, rabbitmq, kafka and ai-gateway stay Pending.
- **`roboshop-secrets`.** Argo CD does not manage Secrets. After the namespace exists, from the tools
  checkout: `python3 scripts/argocd/bootstrap.py --app-secrets-only --context roboshop-demo`. External
  values such as Razorpay, SES and Turnstile are set separately.
- **Git.** Every source is read from `master`, so these changes must be merged before syncing.

Nodes pull from ECR with their node role, so the `ecr-pull` references only produce a warning event.

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
