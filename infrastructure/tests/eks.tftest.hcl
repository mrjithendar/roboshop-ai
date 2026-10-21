mock_provider "aws" {
  mock_data "aws_eks_addon_version" {
    defaults = { version = "v1.0.0-eksbuild.1" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
}
variables {
  environment        = "test"
  availability_zones = ["us-east-1a", "us-east-1b"]
}
run "disabled_by_default" {
  command = plan
  assert {
    condition     = length(aws_eks_cluster.main) == 0
    error_message = "Existing network-only callers must not create EKS automatically."
  }
}
run "private_cluster" {
  command = plan
  variables {
    eks_enabled              = true
    eks_admin_principal_arns = ["arn:aws:iam::123456789012:role/admin"]
  }
  assert {
    condition     = aws_eks_cluster.main[0].vpc_config[0].endpoint_private_access && !aws_eks_cluster.main[0].vpc_config[0].endpoint_public_access
    error_message = "API must default to private-only."
  }
  assert {
    condition     = aws_eks_node_group.main[0].ami_type == "AL2023_x86_64_STANDARD" && aws_eks_node_group.main[0].scaling_config[0].desired_size == 2
    error_message = "Use two AL2023 workers by default."
  }
  assert {
    condition     = length(aws_eks_access_entry.admins) == 1 && length(aws_eks_addon.core) == 4
    error_message = "Explicit admin access and all core add-ons must be configured."
  }
}
run "reject_world_open_api" {
  command = plan
  variables { eks_public_access_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.eks_public_access_cidrs]
}
run "reject_missing_admin" {
  command = plan
  variables { eks_enabled = true }
  expect_failures = [aws_eks_cluster.main]
}
run "connected_private_runner" {
  command = plan
  variables {
    eks_enabled              = true
    eks_admin_principal_arns = ["arn:aws:iam::123456789012:role/admin"]
    eks_private_access_cidrs = ["10.20.0.5/32"]
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.eks_private_api["10.20.0.5/32"].from_port == 443 && aws_vpc_security_group_ingress_rule.eks_private_api["10.20.0.5/32"].to_port == 443 && !aws_eks_cluster.main[0].vpc_config[0].endpoint_public_access
    error_message = "Private runner access must open only API TLS, without enabling the public endpoint."
  }
}
run "reject_sts_admin" {
  command = plan
  variables { eks_admin_principal_arns = ["arn:aws:sts::123456789012:assumed-role/admin/session"] }
  expect_failures = [var.eks_admin_principal_arns]
}
run "reject_world_open_private_api" {
  command = plan
  variables { eks_private_access_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.eks_private_access_cidrs]
}
