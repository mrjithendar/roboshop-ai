# mk4 Argo CD applications

RoboShop on mk4, the minikube cluster Argo CD itself runs in. The Applications live in mk4's `argocd`
namespace with `destination.server: https://kubernetes.default.svc` and are named `roboshop-<app>`, beside
the `roboshop-demo-*` Applications from [`argocd-eks`](../argocd-eks/README.md), whose cluster no longer exists.

They use manual sync, no finalizers, and must never be synced with prune.

## Scope

| Applications | Source |
| --- | --- |
| cart-service, catalogue-service, currency-service, mcp-server, payment-service, redis, shipping-service, user-service, web | The `services/<service>` manifests as they are. |
| ai-gateway, kafka-bridge, postgres, rabbitmq | The same, with their volumes on the `standard` StorageClass. |
| moks | The same, with the widget origins set to `https://jithendar.com`. |
| mongodb | `argocd-eks/apps/data` (StatefulSet, ServiceAccount, catalog ConfigMap) on `standard`. |
| config | Namespace and ConfigMap from `argocd-eks/apps/roboshop`, with `PUBLIC_ORIGIN`, `TURNSTILE_HOSTNAME` and `DEPLOYMENT_ENVIRONMENT` set for mk4. |
| routing | Traefik Ingresses and Middlewares in `apps/routing`: `https://jithendar.com/roboshop` to `web`, prefix stripped. |
| mesh | `apps/mesh`: PeerAuthentication `default` (STRICT) and NetworkPolicy `istio-sidecars`. |

Differences from `argocd-eks`:

- **Smaller mesh.** mk4 runs Istio (tools `minikube-infrastructure`, with the CNI plugin) and Traefik has a
  sidecar. `config` labels the namespace `istio-injection=enabled`, and `mesh` (`apps/mesh`) sets STRICT mTLS plus
  the NetworkPolicy Prometheus needs for the sidecar ports. No ServiceAccount patches or AuthorizationPolicies:
  pods use the namespace's default ServiceAccount.
- **Storage.** mk4 has only minikube-hostpath `standard`; the manifests ask for EKS `gp3-encrypted`, so the
  five Applications with volumes patch it. Data lives on the node that first scheduled the pod.
- **Project.** `roboshop`, limited to the `roboshop-ai` namespace in this cluster, with Secrets denied.

## Prerequisites

- **`harbor-pull`.** Every service pulls `registry.jithendar.com/jithendar/roboshop-*:latest`. From the tools
  checkout: `python3 deploy/minikube/harbor/registry.py pull-secrets --namespace roboshop-ai` (asks for the
  `robot$k8s-pull` secret).
- **`roboshop-secrets`.** Argo CD does not manage Secrets. From the tools checkout:
  `python3 scripts/argocd/bootstrap.py --app-secrets-only --context mk4`. Razorpay, SES and Turnstile values are
  set separately; without Turnstile keys, registration is refused.
- **Git.** Every source is read from `master`, so these files must be merged before syncing.

## Deploy

```bash
kubectl --context mk4 apply -k argocd-minikube
argocd app sync argocd/roboshop-config
# create harbor-pull and roboshop-secrets (Prerequisites), then:
argocd app sync argocd/roboshop-mongodb argocd/roboshop-postgres argocd/roboshop-rabbitmq \
  argocd/roboshop-redis argocd/roboshop-kafka-bridge
argocd app sync --project roboshop
```

### Turning on the mesh

Needs Istio with its CNI plugin and Traefik's sidecar from tools first. Then:

```bash
argocd app sync argocd/roboshop-config          # labels the namespace
kubectl --context mk4 -n roboshop-ai rollout restart deployment,statefulset
kubectl --context mk4 -n roboshop-ai get pods   # every pod 2/2 (kafka 3/3)
argocd app sync argocd/roboshop-mesh            # STRICT: only after every pod has a sidecar
```

Then open `https://jithendar.com/roboshop/`.

`tools/scripts/argocd/deploy.py` does not read this catalog.
