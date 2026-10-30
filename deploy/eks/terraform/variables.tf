variable "region" {
  description = "AWS Region for every resource in this stack."
  type        = string
}

variable "name" {
  description = "Cluster and resource name prefix, for example roboshop-demo. Lowercase letters, digits and hyphens."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "name must be 3-31 characters: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Environment label applied to resources and used in secret names (demo, staging, prod)."
  type        = string
  default     = "demo"
}

variable "owner" {
  description = "Owner tag (team or person). Required so every resource is attributable."
  type        = string
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version. Every pinned add-on and controller in ../versions.md is checked against it."
  type        = string
  default     = "1.36"
}

variable "availability_zones" {
  description = "Explicit AZ names (2 or 3). Check they exist in your account: aws ec2 describe-availability-zones."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2 && length(var.availability_zones) <= 3
    error_message = "Use two or three availability zones."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR. Must not overlap networks you peer or connect to."
  type        = string
  default     = "10.40.0.0/16"
}

variable "single_nat_gateway" {
  description = "true: one NAT gateway (demo, cheaper, egress depends on one AZ). false: one NAT per AZ (production)."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "Create interface endpoints for ECR, STS, CloudWatch Logs, Secrets Manager, SQS and EC2. Reduces NAT traffic; each endpoint has an hourly cost per AZ."
  type        = bool
  default     = false
}

variable "api_public_access_cidrs" {
  description = "CIDRs allowed to reach the public Kubernetes API endpoint (your operator IP as /32). Empty list = private endpoint only (you then need VPN, SSM or a bastion in the VPC)."
  type        = list(string)

  validation {
    condition     = !contains(var.api_public_access_cidrs, "0.0.0.0/0")
    error_message = "Do not open the Kubernetes API to 0.0.0.0/0. Use your own /32, or an empty list for private-only access."
  }
}

variable "admin_principal_arns" {
  description = "IAM role/user ARNs that receive cluster-admin through EKS access entries."
  type        = list(string)
  default     = []
}

variable "enable_cluster_creator_admin" {
  description = "Grant cluster-admin to the identity running terraform apply. Turn off once admin_principal_arns covers your operators."
  type        = bool
  default     = true
}

variable "control_plane_log_types" {
  description = "EKS control-plane log categories sent to CloudWatch Logs. controllerManager and scheduler are omitted by default to limit log volume."
  type        = list(string)
  default     = ["api", "audit", "authenticator"]
}

variable "log_retention_days" {
  description = "Retention for control-plane and application log groups."
  type        = number
  default     = 30
}

variable "system_node_instance_types" {
  description = "Instance types for the stable system node group. Must be arm64 (Graviton): RoboShop images are published for linux/arm64 only."
  type        = list(string)
  default     = ["m7g.large", "m6g.large"]
}

variable "system_node_count" {
  description = "Size of the stable system node group (min = desired). Hosts Karpenter, CoreDNS and the other controllers."
  type        = number
  default     = 2
}

variable "ecr_repository_prefix" {
  description = "Prefix for application image repositories; matches ECR_REPOSITORY_PREFIX in .github/workflows/publish-ecr.yml."
  type        = string
  default     = "roboshop"
}

variable "ecr_repositories" {
  description = "Application image repository suffixes (one per service Dockerfile)."
  type        = list(string)
  default = [
    "ai-gateway", "cart-service", "catalogue-service", "currency-service", "kafka-bridge",
    "mcp-server", "moks", "payment-service", "shipping", "user-service", "web",
  ]
}

variable "manage_ecr_repositories" {
  description = "true: create immutable repositories here. false: reuse existing repositories with the same names (for example the lab stack in infrastructure/ in the same account)."
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "owner/repo allowed to push images through GitHub Actions OIDC. Empty = no CI role."
  type        = string
  default     = ""
}

variable "github_branch" {
  description = "Branch whose workflows may assume the image-publishing role."
  type        = string
  default     = "master"
}

variable "create_github_oidc_provider" {
  description = "Create the token.actions.githubusercontent.com OIDC provider. Set false if your account already has one."
  type        = bool
  default     = true
}

variable "route53_zone_id" {
  description = "Hosted zone that cert-manager may change for DNS-01 challenges. Empty = no Route 53 permissions (use another issuer)."
  type        = string
  default     = ""
}

variable "bedrock_model_arns" {
  description = "Bedrock foundation-model or inference-profile ARNs Moks may invoke. Empty = AI stays unconfigured (the default)."
  type        = list(string)
  default     = []
}

variable "secrets_prefix" {
  description = "Secrets Manager name prefix read by External Secrets. Secret values are never managed by Terraform."
  type        = string
  default     = "roboshop"
}
