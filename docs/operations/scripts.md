# Supported infrastructure commands

Run commands from the repository root. Application deployments are managed by
[Argo CD](../../argocd/README.md), not shell rollout scripts.

| Command | Purpose |
| --- | --- |
| `./init.sh --profile minikube` | Install/check host prerequisites; never starts the cluster. |
| `./deploy-minikube.sh start` | Create/start Minikube; also supports status, stop and diagnose. |
| `./deploy-traefik.sh` | Install/update the Traefik controller using the pinned chart and values. |
| `./patch-ssl.sh` | Reuse the existing Ready site certificate for shared Traefik TLS. |
| `./kubectl.sh <args>` | Forward kubectl commands using KUBECONFIG or the downloaded cluster config. |

Use `--help` on each command. Set `PROFILE`, `KUBE_CONTEXT` and `KUBECONFIG`
for the intended cluster. `deploy-minikube.sh reset` is destructive and is not
part of normal deployment. TLS setup requires a working API and the existing
certificate; deploy cert-manager and certificate resources through Argo CD first.

Supporting implementations stay in `scripts/setup`, `scripts/dev`, `scripts/lib`,
`minikube/install.sh`, `minikube/deploy-traefik.sh` and `minikube/shared-tls`.
Cluster networking, kubeconfig and lifecycle helpers remain dependencies of
cluster operations. Build, CI runner, runtime, credential, diagnostic and test
tools are retained; they are not application deployment entry points.

Logging uses Loki and Alloy: run `./deploy-loki.sh --context mk4`. See [logging setup](../../observability/loki/README.md).
