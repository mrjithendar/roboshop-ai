module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.29.0"

  name               = var.name
  kubernetes_version = var.kubernetes_version

  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnets
  control_plane_subnet_ids = module.vpc.private_subnets

  # Operator access path: private endpoint for nodes and in-VPC tools, plus an optional public
  # endpoint restricted to the operator CIDRs. An empty list makes the API private-only.
  endpoint_private_access      = true
  endpoint_public_access       = length(var.api_public_access_cidrs) > 0
  endpoint_public_access_cidrs = var.api_public_access_cidrs

  authentication_mode                      = "API"
  enable_cluster_creator_admin_permissions = var.enable_cluster_creator_admin
  access_entries = {
    for i, arn in var.admin_principal_arns : "admin-${i}" => {
      principal_arn = arn
      policy_associations = {
        admin = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }

  # Control-plane logs: deliberate categories and retention (variables.tf).
  enabled_log_types                      = var.control_plane_log_types
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  # Kubernetes Secrets are envelope-encrypted with a module-managed KMS key (module default).

  # Add-on versions are pinned (from `aws eks describe-addon-versions`, default for 1.36 on
  # 2026-10-30) so a re-apply never silently upgrades them. See ../versions.md.
  addons = {
    vpc-cni = {
      before_compute = true
      addon_version  = "v1.22.4-eksbuild.10"
      # The network policy agent makes NetworkPolicy objects enforceable on this cluster.
      configuration_values = jsonencode({ enableNetworkPolicy = "true" })
    }
    eks-pod-identity-agent = {
      before_compute = true
      addon_version  = "v1.4.1-eksbuild.3"
    }
    kube-proxy = {
      addon_version = "v1.36.0-eksbuild.58"
    }
    coredns = {
      addon_version = "v1.14.7-eksbuild.22"
      configuration_values = jsonencode({
        tolerations = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
      })
    }
    aws-ebs-csi-driver = {
      addon_version = "v1.67.2-eksbuild.1"
      pod_identity_association = [{
        role_arn        = aws_iam_role.pod_identity["ebs-csi"].arn
        service_account = "ebs-csi-controller-sa"
      }]
    }
  }

  # Stable capacity for critical controllers (Karpenter must never run on nodes it manages).
  # Tainted so application pods land on Karpenter capacity instead.
  eks_managed_node_groups = {
    system = {
      ami_type       = "AL2023_ARM_64_STANDARD"
      instance_types = var.system_node_instance_types
      capacity_type  = "ON_DEMAND"
      min_size       = var.system_node_count
      max_size       = var.system_node_count + 1
      desired_size   = var.system_node_count

      labels = {
        "roboshop.dev/pool" = "system"
      }
      taints = {
        critical = {
          key    = "CriticalAddonsOnly"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      }

      metadata_options = {
        http_endpoint               = "enabled"
        http_tokens                 = "required"
        http_put_response_hop_limit = 1 # pods use Pod Identity, not the node role via IMDS
      }
    }
  }

  node_security_group_tags = {
    "karpenter.sh/discovery" = var.name
  }
}

resource "aws_cloudwatch_log_group" "applications" {
  name              = "/roboshop/${var.name}/containers"
  retention_in_days = var.log_retention_days
}
