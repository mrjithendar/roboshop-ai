> EKS is now available as an opt-in stack in `eks.tf`; see
> [EKS cluster and add-ons](eks-addons/README.md) for creation, versions and Let's Encrypt.
> The manual Create infrastructure workflow now enables EKS and installs its add-ons.

# RoboShop infrastructure: VPC, ECR, SES and optional EKS

This stack creates VPC networking, private ECR repositories, optional SES and an
opt-in EKS cluster. It does not deploy application workloads. Use Terraform >= 1.10 and < 2.0, AWS provider 6.x, and AWS credentials
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
plan using `vars/dev.tfvars`. It provisions VPC/ECR/SES/EKS and then add-ons, not application
containers. Every run applies changes; there is no plan-only option.

The runner must already have AWS credentials (for example, an EC2 instance role)
with permission to manage VPC/ECR/SES/EKS/IAM resources and access the existing S3 states and
lockfile. No OIDC role or AWS access keys are configured in this workflow. The S3
backend bucket must exist before the run.

Open **Actions → Create infrastructure → Run workflow** on the default branch.
No form inputs are needed. The workflow detects the runner IAM role/user and public IPv4 /32 as explained in the
[EKS pipeline guide](eks-addons/README.md#deploy-through-github-actions). Runs are serialized, Terraform uses S3 state locking, and the saved plan
is removed even if a step fails. Do not run the Jenkins deployment concurrently
against the same state.

The workflow installs Terraform 1.16.6. The self-hosted runner needs access to
GitHub, HashiCorp downloads, AWS APIs and the state bucket.

## ECR repositories

`ecr.tf` creates one private repository per name in the `list(string)` variable
`ecr_repository_names`, using `for_each = toset(var.ecr_repository_names)`.
The default list in `_variables.tf` covers 16 active custom service images. The retired SMTP repository entry is
commented out; applying this change removes that repository from Terraform-managed
infrastructure and can delete its images because `force_delete` is enabled. It matches CI's default `ECR_REPOSITORY_PREFIX=roboshop`; shipping uses
`roboshop-shipping`, not `roboshop-shipping-service`. Official third-party
images such as MongoDB, Redis and RabbitMQ do not need project repositories.

To override the list, add the complete desired list to your environment tfvars:

```hcl
ecr_repository_names = [
  "roboshop-ai-gateway",
  "roboshop-frontend",
  "roboshop-shipping",
]
```

Omit the override to keep all defaults. An override replaces the entire list;
removing a name plans deletion of that repository. Reordering names does not
replace repositories. `[]` manages no repositories (and plans removal of any
repositories previously managed in this state). Nonempty repositories cannot be
deleted because `force_delete = false`. No automatic image cleanup is configured.

Repositories use AES-256 encryption, scan on push, shared project/environment tags,
and mutable image tags so each service CI can overwrite `latest`. Apply this
Terraform change to existing repositories before publishing `latest` again.
This change provisions repositories only, not IAM roles,
or GitHub OIDC. All 14 active service CI workflows publish to these
repositories; see [ECR CI setup](../docs/deployment/ecr-ci.md). See the
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
  'aws_ecr_repository.services["roboshop-ai-gateway"]' roboshop-ai-gateway
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

Enable `eks_enabled` and supply explicit admin IAM principals using
`vars/eks.tfvars.example`. Follow [the EKS guide](eks-addons/README.md) for the
separate cluster and add-on apply steps. Worker nodes use private subnets; public
subnets are reserved for load balancers. Private-only API access requires a runner
with VPC connectivity; public API access accepts only your configured CIDRs.

The new cluster includes managed nodes, core add-ons and access entries. The
separate add-on stack installs EBS CSI, Traefik, AWS Load Balancer Controller,
cert-manager and KEDA. Application data migration and workload IAM remain separate.

References: [EKS subnet requirements](https://docs.aws.amazon.com/eks/latest/userguide/network-reqs.html),
[subnet design](https://docs.aws.amazon.com/eks/latest/best-practices/subnets.html),
[S3 backend locking](https://developer.hashicorp.com/terraform/language/backend/s3).

## Amazon SES transactional email

`ses.tf` provisions the `jithendar.com` SES identity with 2048-bit Easy DKIM, a
`bounce.jithendar.com` custom MAIL FROM domain, and an IAM user restricted to
`ses:SendRawEmail` from `no-reply@jithendar.com` using this identity. Dev enables
SES in `vars/dev.tfvars`; other environments opt in with `ses_enabled = true`.
All SES resources use the stack's AWS region (dev: `us-east-1`). No application
SMTP configuration or DNS records are changed automatically.

Run **Create infrastructure** to apply the stack, then inspect its SES outputs:

```bash
terraform output -json ses_dns_records
terraform output -json ses_smtp
```

Publish the three DKIM CNAME records and the bounce-subdomain MX/TXT records in
your authoritative DNS provider. In Cloudflare, CNAMEs must be DNS-only. For the MX
record, enter priority `10` separately from the hostname. Do not replace your root
domain MX or existing SPF records; these MAIL FROM records belong to `bounce`.
Keep/review your existing `_dmarc.jithendar.com` policy. Wait for SES identity and
MAIL FROM verification before sending; the custom MAIL FROM policy rejects mail
while its DNS is unverified. Terraform apply does not mean DNS verification has
completed.

The Terraform execution role now needs SES identity and IAM user/policy management
permissions. It creates no access keys or passwords. Generate SMTP credentials for
the restricted IAM user separately using AWS's documented SMTP credential process;
its IAM user name is not the SMTP username, and an AWS secret access key is not an
SMTP password. Store SMTP credentials in Kubernetes Secrets, not source control.
SES SMTP settings are `email-smtp.us-east-1.amazonaws.com:587` with STARTTLS.

User-service's Minikube manifest now sends directly through SES on port 587. It
reads `SMTP_USERNAME` and `SMTP_PASSWORD` from `roboshop-secrets`, and uses the system
CA trust store. The private SMTP certificate mount and certificate environment
variables are removed. Keep `AUTH_ENCRYPTION_KEY` unchanged. Populate the SES SMTP
credentials before deploying the updated manifest. The deployment workflow removes
the retired SMTP workload but retains its queue and certificates. ECR removal
is controlled separately by the Terraform repository list.

If SES is in the sandbox, recipient addresses must also be verified (except SES
mailbox simulator addresses). Request production access in the sending region to
send resets to ordinary users; Terraform does not approve that request. SES sending
is billed according to AWS usage pricing.

References: [SES identities](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html),
[SES SMTP setup](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html),
[SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html).
