output "region" {
  value = var.region
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "kubeconfig_command" {
  description = "Run this to add the cluster to your kubeconfig."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}"
}

output "karpenter_node_role_name" {
  description = "Referenced by the EC2NodeClass (../k8s/karpenter)."
  value       = module.karpenter.node_iam_role_name
}

output "karpenter_interruption_queue" {
  description = "Helm value settings.interruptionQueue."
  value       = module.karpenter.queue_name
}

output "ecr_registry" {
  value = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "ecr_repositories" {
  value = { for k, r in local.ecr_repositories : k => r.url }
}

output "github_ecr_push_role_arn" {
  description = "Set as AWS_ROLE_ARN in GitHub Actions (empty when github_repository is unset)."
  value       = local.github_enabled ? aws_iam_role.github_ecr_push[0].arn : ""
}

output "app_secret_name" {
  value = aws_secretsmanager_secret.app.name
}

output "application_log_group" {
  value = aws_cloudwatch_log_group.applications.name
}
