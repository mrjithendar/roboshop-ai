# RobotShop infrastructure: VPC and ECR

This stack creates VPC networking and private ECR repositories; it does not create
an EKS cluster or deploy applications. Use Terraform >= 1.10 and < 2.0, AWS provider 6.x, and AWS credentials
from an IAM role or your normal AWS profile. Commit the generated provider lockfile.

## Network layout

`vars/dev.tfvars` selects us-east-1a/us-east-1b in us-east-1. Confirm these AZs are
available to your account, and that 10.0.0.0/16 does not overlap any connected
network. Two or three explicitly ordered AZs are supported.

| Layer | First two CIDRs | Purpose |
| --- | --- | --- |
| Private | 10.0.0.0/20, 10.0.16.0/20 | EKS nodes, pod addresses and control-plane ENIs |
| Public | 10.0.240.0/24, 10.0.241.0/24 | Internet-facing load balancers and NAT gateways |

Public subnets route to an Internet Gateway. Private subnets use a NAT in the same
AZ by default. `single_nat_gateway = true` reduces demo NAT costs but makes egress
depend on the first AZ and may incur cross-AZ traffic charges. Both subnet types
disable automatic instance public IP assignment; public load balancers and NATs
manage their own addresses. Subnet role tags support load-balancer discovery.
An S3 gateway endpoint serves private subnet S3 traffic, including ECR layers;
ECR API/registry, STS and other external requests still use NAT. This is not an
isolated/no-internet VPC. No default-VPC peering is created.

## Backend and first deployment

The existing S3 backend location is preserved:
`jithendardharmapuri`, `terraform/vpc.tfstate`, `us-east-1`. Verify ownership and
whether that key already contains infrastructure state before proceeding. The
bucket must already exist; enable versioning and block public access. State is
encrypted and Terraform S3 lockfiles are enabled. Grant the runner state read/write
and lockfile read/write/delete permissions, plus the necessary VPC and ECR provisioning
permissions. Do not put credentials in tfvars or backend files.

For a new environment, select a distinct state key at init; never share demo and
production state. Do not change the backend of existing resources without a
planned state migration.

```bash
cd infrastructure
terraform init
terraform fmt -check
terraform validate
terraform test
terraform plan -var-file=vars/dev.tfvars -out=plan.tfplan
# Inspect the plan, especially subnet replacements, before running:
terraform apply plan.tfplan
terraform output
```

The Jenkinsfile assumes checkout at repository root, uses `dir('vpc')`, takes
credentials from the agent's AWS role, and pauses for review before applying the
saved plan. Install a supported Terraform version on the agent. Do not run this
apply pipeline against untrusted pull-request code. Mock tests do not access AWS.

## GitHub Actions deployment

The [Create infrastructure workflow](../.github/workflows/create-infrastructure.yml)
runs manually on the self-hosted runner. It checks formatting, initializes remote
state, validates and tests the configuration, then creates and applies a saved
plan using `vars/dev.tfvars`. It provisions VPC/ECR resources, not EKS or application
containers. Every run applies changes; there is no plan-only option.

The runner must already have AWS credentials (for example, an EC2 instance role)
with permission to manage VPC/ECR resources and access the existing S3 state and
lockfile. No OIDC role or AWS access keys are configured in this workflow. The S3
backend bucket must exist before the run.

Open **Actions → Create infrastructure → Run workflow** and select your intended
branch. Runs are serialized, Terraform uses S3 state locking, and the saved plan
is removed even if a step fails. Do not run the Jenkins deployment concurrently
against the same state.

The workflow installs Terraform 1.10.5. The self-hosted runner needs access to
GitHub, HashiCorp downloads, AWS APIs and the state bucket.

## ECR repositories

`ecr.tf` creates one private repository per name in the `list(string)` variable
`ecr_repository_names`, using `for_each = toset(var.ecr_repository_names)`.
The default list in `_variables.tf` covers all 15 custom service images, including
SMTP. It matches CI's default `ECR_REPOSITORY_PREFIX=robotshop`; shipping uses
`robotshop-shipping`, not `robotshop-shipping-service`. Official third-party
images such as MongoDB, Redis and RabbitMQ do not need project repositories.

To override the list, add the complete desired list to your environment tfvars:

```hcl
ecr_repository_names = [
  "robotshop-ai-gateway",
  "robotshop-frontend",
  "robotshop-shipping",
]
```

Omit the override to keep all defaults. An override replaces the entire list;
removing a name plans deletion of that repository. Reordering names does not
replace repositories. `[]` manages no repositories (and plans removal of any
repositories previously managed in this state). Nonempty repositories cannot be
deleted because `force_delete = false`. No automatic image cleanup is configured.

Repositories use AES-256 encryption, scan on push, shared project/environment tags,
and immutable image tags. CI already publishes unique `sha-...` tags. Repeatedly
pushing a `local` or `latest` tag is incompatible with immutability; use unique
release tags in ECR. This change provisions repositories only, not IAM roles,
GitHub OIDC, or a new SMTP CI workflow. See the
[AWS provider ECR resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecr_repository).

Run the init/validate/plan/apply commands above for the combined VPC/ECR stack;
review the saved plan because it can also include network changes. After applying:

```bash
terraform output -json ecr_repository_urls
terraform output -json ecr_repository_arns
```

The GitHub workflow's `AWS_REGION` must match `aws_region`. If you change its
`ECR_REPOSITORY_PREFIX`, update the names in this list accordingly. Grant the
publishing role ECR push permissions scoped to these ARNs and
`ecr:GetAuthorizationToken` on `*`; EKS node/pod execution roles need pull access.
Repository names are unique per AWS account/region, so separate states in the
same account/region must use different names or share one owning registry stack.

Import repositories that already exist before planning creation, for example:

```bash
terraform import -var-file=vars/dev.tfvars \
  'aws_ecr_repository.services["robotshop-ai-gateway"]' robotshop-ai-gateway
```

## Existing deployments

This is a layout change intended for the new VPC requested for EKS. Existing
randomly selected AZs and /24 private subnets are replaced by explicit AZs and /20
subnets. Applying to an existing stack may replace subnets/NAT gateways and remove
the former default-VPC peering connection and unused random resources. Do not apply
such replacements under an existing cluster. Use a separate state key and a
non-overlapping VPC CIDR for a parallel migration, or retain the old layout until
an explicit migration is planned. No state or cloud resources were changed during
this code review.

## Creating EKS on this VPC

Use `vpc_id` and `eks_subnet_ids` (private subnet IDs) in your EKS stack; use the
same private IDs for managed node groups. `public_subnets` are for public load
balancers, not worker nodes. Enable private EKS API access. If public API access
is also enabled, restrict its CIDRs to administrator/CI egress addresses; a private-
only endpoint requires VPC connectivity from your administration runner.

The EKS stack still needs cluster/node IAM roles, security groups, access entries,
VPC CNI, CoreDNS, kube-proxy, storage CSI drivers and Pod Identity/IRSA for workloads.
Install/configure AWS Load Balancer Controller unless using EKS Auto Mode load
balancing. Enable cluster logs and configure VPC flow logs and retention as part
of the deployment's observability policy. Those resources are outside this VPC
stack. Size pod IP capacity against your node counts before deployment.

References: [EKS subnet requirements](https://docs.aws.amazon.com/eks/latest/userguide/network-reqs.html),
[subnet design](https://docs.aws.amazon.com/eks/latest/best-practices/subnets.html),
[S3 backend locking](https://developer.hashicorp.com/terraform/language/backend/s3).
