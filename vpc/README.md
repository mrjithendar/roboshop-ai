# RobotShop VPC for EKS

This stack creates networking only; it does not create an EKS cluster or deploy
applications. Use Terraform >= 1.10 and < 2.0, AWS provider 6.x, and AWS credentials
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
and lockfile read/write/delete permissions, plus the necessary VPC provisioning
permissions. Do not put credentials in tfvars or backend files.

For a new environment, select a distinct state key at init; never share demo and
production state. Do not change the backend of existing resources without a
planned state migration.

```bash
cd vpc
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
