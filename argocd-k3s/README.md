# Hetzner k3s Argo CD applications

RoboShop on the Hetzner k3s cluster `jithendar` (`hetzner-k3s.yaml` in the Work folder: 1 master and 2 workers,
all arm64), the cluster Argo CD itself runs in. The Applications live in the cluster's `argocd` namespace with
`destination.server: https://kubernetes.default.svc` and are named `roboshop-<app>`.

The catalog is a copy of [`argocd-minikube`](../argocd-minikube/README.md) with only these changes:

- **Storage.** The five Applications with volumes (ai-gateway, kafka-bridge, mongodb, postgres, rabbitmq)
  patch the EKS `gp3-encrypted` StorageClass to `hcloud-volumes` (Hetzner Cloud volumes, the cluster default).
  Each volume is at least 10 GB and billed monthly. Unlike `local-path`, it can follow a pod to another node in `fsn1`.
- **Config.** `DEPLOYMENT_ENVIRONMENT` is `k3s`. `PUBLIC_ORIGIN` and `TURNSTILE_HOSTNAME` stay on `jithendar.com`.
- **Paths.** `mesh` and `routing` read `argocd-k3s/apps/*`.

Every Application syncs automatically with `selfHeal`, never prunes, and has no finalizer.

## Cluster prerequisites (already in place)

- Argo CD in `argocd`. Istio with its CNI plugin (`istio-system`). The ingress gateway `istio-ingress/public` for
  `jithendar.com`.
- The edge routing table, VirtualService `istio-ingress/jithendar-com`, delegates `/roboshop` to
  `roboshop-ai/roboshop`. That is the VirtualService in `apps/routing`.
- Secrets in `roboshop-ai`, which Argo CD does not manage (the project denies Secrets):
  - `harbor-pull`: pulls from `registry.jithendar.com`.
  - `roboshop-secrets`
  - `redis-roboshop-credentials`: the shared Valkey `valkey-master.redis`, ACL user `roboshop`, db 6, written by
    Terraform.
- **arm64 images.** Every `registry.jithendar.com/jithendar/roboshop-*:latest` image must include `linux/arm64`;
  otherwise its pods fail with `exec format error`. Check with
  `docker buildx imagetools inspect registry.jithendar.com/jithendar/roboshop-web:latest`.
- **Git.** Every source is read from `master`, so this directory must be pushed before applying.

## Deploy

```bash
export KUBECONFIG=~/Desktop/Work/kubeconfig-hetzner
kubectl config current-context            # make sure this is the Hetzner cluster

# Label first so every pod starts with a sidecar (roboshop-config keeps the label afterwards)
kubectl label namespace roboshop-ai istio-injection=enabled --overwrite

kubectl apply -k argocd-k3s
kubectl -n argocd get applications -l app.kubernetes.io/part-of=roboshop-k3s
kubectl -n roboshop-ai get pods,pvc       # pods 2/2 (kafka 3/3), PVCs Bound on hcloud-volumes
```

`roboshop-mesh` sets STRICT mTLS. If a pod started before the namespace label, it has no sidecar and STRICT blocks
it, so restart it with `kubectl -n roboshop-ai rollout restart deployment,statefulset`.

Then open `https://jithendar.com/roboshop/`.

## Remove

The Applications have no finalizers, so deleting them leaves the workloads running:

```bash
kubectl delete -k argocd-k3s
```

PVCs on `hcloud-volumes` use the `Delete` reclaim policy. Deleting a PVC deletes its Hetzner volume and its data.
