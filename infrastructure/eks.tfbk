# Opt-in keeps existing VPC/ECR/SES deployments unchanged until EKS is configured.
locals {
  eks_name = "roboshop-${var.environment}"
}
variable "eks_enabled" {
  type    = bool
  default = false
}
variable "eks_version" {
  description = "1.36 is in EKS standard support and within cert-manager 1.21's tested range."
  type        = string
  default     = "1.36"
}
variable "eks_admin_principal_arns" {
  description = "IAM role/user ARNs for cluster administrators; not STS session ARNs."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.eks_admin_principal_arns : can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", arn))])
    error_message = "Use IAM role/user ARNs, not STS assumed-role session ARNs."
  }
}
variable "eks_public_access_cidrs" {
  description = "Admin/CI public IPv4 CIDRs; empty means private-only API."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for c in var.eks_public_access_cidrs : can(cidrnetmask(c)) && !endswith(c, "/0")])
    error_message = "Use restricted IPv4 CIDRs; world-open API access is not allowed."
  }
}
variable "eks_private_access_cidrs" {
  description = "Connected runner/admin IPv4 CIDRs allowed to the private EKS API on TCP 443. Does not create routing or VPN connectivity."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for c in var.eks_private_access_cidrs : can(cidrnetmask(c)) && !endswith(c, "/0")])
    error_message = "Use restricted IPv4 CIDRs for private API access."
  }
}
variable "eks_node_instance_types" {
  type    = list(string)
  default = ["t3.large"]
}
variable "eks_node_count" {
  type    = number
  default = 2
  validation {
    condition     = var.eks_node_count >= 2 && var.eks_node_count <= 6 && floor(var.eks_node_count) == var.eks_node_count
    error_message = "Choose 2 through 6 worker nodes."
  }
}
resource "aws_iam_role" "eks_cluster" {
  count              = var.eks_enabled ? 1 : 0
  name               = "${local.eks_name}-cluster"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "eks.amazonaws.com" } }] })
  tags               = local.common_tags
}
resource "aws_iam_role_policy_attachment" "eks_cluster" {
  count      = var.eks_enabled ? 1 : 0
  role       = aws_iam_role.eks_cluster[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}
resource "aws_cloudwatch_log_group" "eks" {
  count             = var.eks_enabled ? 1 : 0
  name              = "/aws/eks/${local.eks_name}/cluster"
  retention_in_days = 30
  tags              = local.common_tags
}
resource "aws_eks_cluster" "main" {
  count                     = var.eks_enabled ? 1 : 0
  name                      = local.eks_name
  role_arn                  = aws_iam_role.eks_cluster[0].arn
  version                   = var.eks_version
  enabled_cluster_log_types = ["api", "audit", "authenticator"]
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }
  upgrade_policy { support_type = "STANDARD" }
  vpc_config {
    subnet_ids              = local.privateSubnets
    endpoint_private_access = true
    endpoint_public_access  = length(var.eks_public_access_cidrs) > 0
    public_access_cidrs     = length(var.eks_public_access_cidrs) > 0 ? var.eks_public_access_cidrs : null
  }
  lifecycle {
    precondition {
      condition     = length(var.eks_admin_principal_arns) > 0
      error_message = "Set at least one eks_admin_principal_arns entry before enabling EKS."
    }
  }
  tags       = local.common_tags
  depends_on = [aws_iam_role_policy_attachment.eks_cluster, aws_cloudwatch_log_group.eks]
}
resource "aws_eks_access_entry" "admins" {
  for_each      = var.eks_enabled ? var.eks_admin_principal_arns : toset([])
  cluster_name  = aws_eks_cluster.main[0].name
  principal_arn = each.value
  type          = "STANDARD"
}
resource "aws_eks_access_policy_association" "admins" {
  for_each      = aws_eks_access_entry.admins
  cluster_name  = each.value.cluster_name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }
}
resource "aws_iam_role" "eks_nodes" {
  count              = var.eks_enabled ? 1 : 0
  name               = "${local.eks_name}-nodes"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }] })
  tags               = local.common_tags
}
resource "aws_iam_role_policy_attachment" "eks_nodes" {
  for_each   = var.eks_enabled ? toset(["AmazonEKSWorkerNodePolicy", "AmazonEC2ContainerRegistryPullOnly", "AmazonEKS_CNI_Policy"]) : toset([])
  role       = aws_iam_role.eks_nodes[0].name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}
resource "aws_eks_node_group" "main" {
  count           = var.eks_enabled ? 1 : 0
  cluster_name    = aws_eks_cluster.main[0].name
  node_group_name = "general"
  node_role_arn   = aws_iam_role.eks_nodes[0].arn
  subnet_ids      = local.privateSubnets
  version         = var.eks_version
  ami_type        = "AL2023_x86_64_STANDARD"
  instance_types  = var.eks_node_instance_types
  capacity_type   = "ON_DEMAND"
  disk_size       = 50
  scaling_config {
    desired_size = var.eks_node_count
    min_size     = 2
    max_size     = 6
  }
  update_config { max_unavailable = 1 }
  tags       = local.common_tags
  depends_on = [aws_iam_role_policy_attachment.eks_nodes, aws_route_table_association.pr_rta, aws_route_table_association.pl_rta]
}
# AWS resolves the default compatible build for this Kubernetes version at plan time.
data "aws_eks_addon_version" "core" {
  for_each           = var.eks_enabled ? toset(["vpc-cni", "coredns", "kube-proxy", "eks-pod-identity-agent"]) : toset([])
  addon_name         = each.key
  kubernetes_version = var.eks_version
  most_recent        = false
}
resource "aws_eks_addon" "core" {
  for_each                    = data.aws_eks_addon_version.core
  cluster_name                = aws_eks_cluster.main[0].name
  addon_name                  = each.key
  addon_version               = each.value.version
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"
  depends_on                  = [aws_eks_node_group.main]
}
output "eks_cluster_name" {
  value = var.eks_enabled ? aws_eks_cluster.main[0].name : null
}

resource "aws_vpc_security_group_ingress_rule" "eks_private_api" {
  for_each          = var.eks_enabled ? var.eks_private_access_cidrs : toset([])
  security_group_id = aws_eks_cluster.main[0].vpc_config[0].cluster_security_group_id
  description       = "Private EKS API access for connected administration network"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
