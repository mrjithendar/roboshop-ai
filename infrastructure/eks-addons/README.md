# EKS cluster and add-ons

Reviewed 2026-10-21. This is a **new-cluster** setup, not an in-place migration of
the old copied examples or of Minikube workloads. Nothing is deployed by editing
these files. EKS, EC2, NAT, load balancers, logs and volumes incur AWS charges.

## Layout and versions

- `../eks.tf`: opt-in cluster and managed nodes in the existing private subnets.
- This directory: separate Terraform state for Helm/Kubernetes resources, applied
  after EKS exists. The AWS CLI must be installed and authenticated as a configured
  cluster administrator, and the runner must be able to reach the EKS API.
- Kubernetes **1.36**, cert-manager **v1.21.2**, Traefik chart **42.1.0**,
  AWS Load Balancer Controller chart **3.6.0**, KEDA **2.21.0**.
- AWS provider 6.x, Helm provider 3.x, Kubernetes provider 2.x; lockfiles
  select exact builds. AWS add-on builds are resolved against the selected EKS
  version using AWS's default compatible version, and shown in the saved plan.
- Kubernetes 1.37 is available on EKS, but 1.36 is selected to stay inside
  cert-manager 1.21's published tested range. Do not upgrade components independently
  without checking compatibility. Existing cert-manager 1.12 deployments need the
  upstream incremental migration procedure, not this fresh-install chart replacement.

## 1. Create cluster

Use Terraform >=1.10. The pre-existing root backend remains unchanged at
`s3://jithendardharmapuri/terraform/vpc.tfstate`; no backend migration is performed.

```bash
cp infrastructure/vars/eks.tfvars.example /tmp/roboshop-eks.tfvars
# Edit the copy: supply actual IAM admin role ARN(s), and admin/runner public CIDRs.
# The example IP and role are placeholders. Empty CIDRs mean private-only API.
terraform -chdir=infrastructure init
terraform -chdir=infrastructure plan -var-file=vars/dev.tfvars \
  -var-file=/tmp/roboshop-eks.tfvars -out=eks.tfplan
# Review the saved plan before applying it.
terraform -chdir=infrastructure apply eks.tfplan
aws eks update-kubeconfig --region us-east-1 --name roboshop-demo --alias roboshop-eks
kubectl --context=roboshop-eks get nodes
```

EKS remains disabled for existing callers unless `eks_enabled=true` is supplied.
The manual Create infrastructure workflow explicitly enables EKS and applies both
stacks in order; see the pipeline instructions below.
Two `t3.large` on-demand workers are the initial configuration; change count/type
in your reviewed variable file. Private nodes pull ECR images via their node role.
The initial node role includes CNI permissions; move these to a dedicated CNI pod
identity when tightening workload IAM. Other application IAM (SES/Bedrock) is not
created by this stack. No cluster creator gets implicit admin access.

## 2. Install add-ons

```bash
terraform -chdir=infrastructure/eks-addons init
terraform -chdir=infrastructure/eks-addons plan -var=cluster_name=roboshop-demo -out=addons.tfplan
terraform -chdir=infrastructure/eks-addons apply addons.tfplan
kubectl --context=roboshop-eks -n traefik get service traefik
```

The second state is `terraform/eks-addons.tfstate` in the same existing bucket.
Traefik terminates TLS; AWS Load Balancer Controller provisions its public NLB
using pod identity. EBS CSI also uses pod identity. The `gp3` storage class uses
WaitForFirstConsumer, encryption and Retain. Select `storageClassName: gp3` in
new EKS PVCs; do not copy Minikube's `standard` storage class. Existing PVC storage
classes cannot simply be patched; plan data migration/backup separately.

## 3. Let's Encrypt

Keyfactor/EAB configuration has been removed. cert-manager owns its CRDs and RBAC;
never apply old bundled CRDs/permission charts from `reference-only`.

```bash
kubectl --context=roboshop-eks apply -f infrastructure/eks-addons/eks_letsencrypt_issuer.yaml
kubectl --context=roboshop-eks wait --for=condition=Ready clusterissuer/letsencrypt-staging --timeout=120s
kubectl --context=roboshop-eks wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=120s
```

Both HTTP-01 issuers use `ingressClassName: traefik`. Point the intended public DNS
name to the NLB and allow HTTP port 80 for validation (HTTPS 443 for visitors).
Keep the ACME challenge path reachable. Use staging with a test hostname first;
staging certificates are intentionally untrusted. Issuer Ready does not mean a
website certificate has been issued. After the application ingress exists with
`spec.ingressClassName: traefik` and a matching host rule, production TLS can be
requested with:

```bash
kubectl --context=roboshop-eks -n roboshop-ai patch ingress YOUR_INGRESS_NAME \
  --type=merge --patch-file infrastructure/eks-addons/eks_ingress_patch.yaml
kubectl --context=roboshop-eks -n roboshop-ai get certificate,certificaterequest,order,challenge
```

The patch requests `jithendar.com` into `jithendar-com-tls` and replaces the TLS
list on the selected ingress. Review it for multi-host ingresses. Do not switch
production DNS from Vultr until EKS workloads/data are ready. The repository's
Minikube deployment workflow is not an EKS migration workflow.

## Review findings retained for follow-up

`reference-only` preserves the supplied legacy examples; Terraform does not load
nested folders or `.tf.disabled` files. These are **not deployable modules**:

- Duplicate backend targeted a different bucket/state; active stacks now have one
  backend each, with no implicit state migration.
- Missing `module.eks_cap_dev`, cluster data, IAM policy data and locals prevented
  planning. The new cluster stack has no dependency on those missing definitions.
- Karpenter 0.28 uses retired Provisioner/AWSNodeTemplate APIs and old IAM/settings.
  It is not installed; the managed node group provides capacity. A version bump
  alone cannot migrate Karpenter to NodePool/EC2NodeClass.
- ADOT had the wrong pod trust principal, a role-binding name mismatch, missing
  chart directories and hardcoded cluster names. It is not installed by this
  baseline; the existing app OTel stack can be deployed separately.
- The old Bitnami/community ingress-nginx example is replaced by Traefik; community
  ingress-nginx retired in March 2026. Sample echo pods are not deployed.

Before applying to any existing EKS state, inventory `terraform state list` and
plan resource moves/imports explicitly. Removing old resources from an active
state's configuration could otherwise plan deletion. No state operations or
cluster changes were run during this review.

Sources: [EKS versions](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html),
[cert-manager support](https://cert-manager.io/docs/releases/),
[HTTP-01](https://cert-manager.io/docs/configuration/acme/http01/),
[KEDA compatibility](https://keda.sh/docs/2.21/operate/cluster/),
[ingress-nginx retirement](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/).

## Deploy through GitHub Actions

Commit/push the infrastructure and workflow changes to the default branch first.
Open **Actions → Create infrastructure → Run workflow**. This action applies
infrastructure and can incur AWS charges; it is not a preview-only workflow.

No dispatch inputs are needed. The workflow detects its AWS identity via STS.
Assumed roles are resolved through IAM GetRole so role paths are preserved.
The detected IAM role/user becomes the EKS administrator. AWS root and STS
federated-user credentials are rejected before Terraform applies anything.

The runner's public IPv4 address is detected through HTTPS to
checkip.amazonaws.com and allowed as a single /32. This mode expects the runner
to reach the public EKS endpoint using that same egress IP. It does not configure
private VPN access or workstation access. Rerunning from a different runner
replaces the workflow-managed administrator and public CIDR with that runner's
identity/address; use a stable runner identity and egress IP. Additional
administrators/private access require explicitly adapting this configuration.

The Linux self-hosted runner needs AWS CLI, kubectl, Python 3, existing AWS
credentials with infrastructure provisioning permissions, access to both S3 state
keys/lockfiles, and network access to AWS APIs and the EKS API. The workflow installs
Terraform itself. It creates a temporary kubeconfig and removes it after completion;
it does not alter the runner's default kubeconfig. No new repository secrets or
variables are required.

The workflow uses `vars/dev.tfvars`, enables EKS with the detected runner access settings,
and keeps node/version defaults from `eks.tf`. It plans and applies AWS resources,
reads the resulting cluster name, then plans/applies add-ons and applies both
Let's Encrypt issuers. It does not install RoboShop workloads or change DNS.
If add-ons fail after EKS creation, fix the reported issue and rerun from the same
runner; Terraform reuses the infrastructure already recorded in state.

CLI equivalent for dispatch:

```bash
gh workflow run create-infrastructure.yml --ref master
gh run list --workflow=create-infrastructure.yml --limit 5
```

### Follow-up review fixes

Private API access now has explicit security-group ingress through
`eks_private_access_cidrs`. Nodes wait for both private and public NAT route-table
associations. LBC and EBS pod identity trust policies are restricted by cluster,
namespace and service account session tags. The gp3 StorageClass waits for EBS CSI.
The pipeline checks that its own IAM identity is included in the admin list before
applying infrastructure, and runs mock add-on security/storage tests.

The general infrastructure test suite still flags an unrelated existing ECR
configuration: `force_delete=true` conflicts with its deletion-protection test.
That setting has not been changed as part of the EKS review.
