# Version compatibility matrix

Checked on **2026-10-30** against Amazon EKS **1.36**. Every version below is pinned in this
repository; nothing floats to "latest". Change one component at a time and re-run the offline
checks (README.md#offline-checks) before applying.

| Component | Pinned | Where pinned | Compatibility evidence |
| --- | --- | --- | --- |
| Amazon EKS (Kubernetes) | 1.36 | `terraform/variables.tf` | Standard support until 2 Aug 2027 (EKS release calendar) |
| Terraform | >= 1.10, < 2.0 (tested 1.16.6) | `terraform/versions.tf` | S3 native lockfile needs >= 1.10 |
| AWS provider | ~> 6.71 | `terraform/versions.tf`, `.terraform.lock.hcl` | Required by EKS module 21.x |
| terraform-aws-modules/eks | 21.29.0 | `terraform/eks.tf`, `karpenter.tf` | Supports `kubernetes_version`, Pod Identity, access entries |
| terraform-aws-modules/vpc | 6.7.3 | `terraform/network.tf` | |
| vpc-cni add-on | v1.22.4-eksbuild.10 | `terraform/eks.tf` | Default for 1.36 (`aws eks describe-addon-versions`) |
| coredns add-on | v1.14.7-eksbuild.22 | `terraform/eks.tf` | Default for 1.36 |
| kube-proxy add-on | v1.36.0-eksbuild.58 | `terraform/eks.tf` | Default for 1.36 |
| aws-ebs-csi-driver add-on | v1.67.2-eksbuild.1 | `terraform/eks.tf` | Default for 1.36 |
| eks-pod-identity-agent add-on | v1.4.1-eksbuild.3 | `terraform/eks.tf` | Default for 1.36 |
| EKS AL2023 arm64 AMI (Karpenter) | `al2023@v20261026` | `k8s/karpenter/ec2nodeclass.yaml` | SSM `/aws/service/eks/optimized-ami/1.36/amazon-linux-2023/arm64/...` = 1.36.5-20261026 |
| Karpenter | 1.15.1 | `platform/versions.env` | Compatibility matrix: K8s 1.36 needs >= 1.13; 1.37 needs 1.15.x |
| AWS Load Balancer Controller | 3.6.2 (chart 3.6.2) | `platform/versions.env`, `terraform/policies/` | IAM policy vendored from the v3.6.2 tag (sha256 `16f232c9…a6a`) |
| Istio (base, istiod, cni, gateway) | 1.30.7 | `platform/versions.env` | 1.30 supports K8s 1.32–1.36. 1.31.3 exists on GitHub, but its charts were not in the Helm repo on 2026-10-30; move to 1.31 when they are (1.30 EOL expected ~Dec 2026) |
| OPA Gatekeeper | 3.23.1 | `platform/versions.env` | Follows the Kubernetes supported-versions policy |
| KEDA | 2.21.0 | `platform/versions.env` | Tested with K8s 1.34–1.36 |
| cert-manager | v1.21.3 | `platform/versions.env` | |
| External Secrets Operator | 2.14.0 (`external-secrets.io/v1`) | `platform/versions.env` | |
| kube-prometheus-stack | 92.16.0 (Operator v0.94.2) | `platform/versions.env` | |
| OpenTelemetry Collector (contrib) | chart 0.178.1 / collector 0.163.2 | `platform/versions.env` | |
| Jaeger | chart 4.16.1 / Jaeger v2.22.0 | `platform/versions.env` | |
| Argo CD | chart 10.11.6 / v3.5.6 | `platform/versions.env` | |
| Gateway API CRDs | not installed | — | This design uses Istio's own APIs consistently (Gateway, VirtualService, PeerAuthentication, AuthorizationPolicy) |

Application images are linux/arm64 only (`.github/workflows/publish-ecr.yml`), so every node
pool requests `kubernetes.io/arch=arm64` (Graviton).

## How the versions were checked

- EKS versions and add-on defaults: `aws eks describe-addon-versions --addon-name <name>` (read-only) and the
  EKS release calendar.
- AMI release: `aws ssm get-parameters-by-path --path /aws/service/eks/optimized-ami/1.36/amazon-linux-2023/arm64/standard/recommended`.
- Charts: `helm search repo <chart> --versions`, `helm show chart oci://public.ecr.aws/karpenter/karpenter --version 1.15.1`,
  then `helm template` of every chart with the values in `platform/values/` (all rendered without errors).
- Terraform modules and providers: registry.terraform.io version APIs; `terraform init/validate/test`.

## References

- EKS Kubernetes versions and calendar: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html
- EKS network policy (VPC CNI): https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy-configure.html
- EKS Pod Identity: https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html
- Karpenter compatibility: https://karpenter.sh/docs/upgrading/compatibility/
- Karpenter NodeClasses: https://karpenter.sh/docs/concepts/nodeclasses/
- Karpenter disruption: https://karpenter.sh/docs/concepts/disruption/
- AWS Load Balancer Controller install: https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/installation/
- AWS Load Balancer Controller NLB and annotations: https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/ and https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/annotations/
- Istio supported releases: https://istio.io/latest/docs/releases/supported-releases/
- Istio platform prerequisites (EKS): https://istio.io/latest/docs/ambient/install/platform-prerequisites/
- Gatekeeper install: https://open-policy-agent.github.io/gatekeeper/website/docs/install/
- KEDA cluster compatibility: https://keda.sh/docs/latest/operate/cluster/
- KEDA RabbitMQ scaler: https://keda.sh/docs/2.21/scalers/rabbitmq-queue/
- terraform-aws-modules/eks: https://github.com/terraform-aws-modules/terraform-aws-eks
