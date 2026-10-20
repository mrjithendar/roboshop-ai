output "vpc_cidr" {
  value = aws_vpc.vpc.cidr_block
}

output "vpc_id" {
  value = aws_vpc.vpc.id
}

output "private_subnets" {
  value = local.privateSubnets
}

output "public_subnets" {
  value = local.publicSubnets
}

output "subnets" {
  value = local.subnets
}

output "public_rt" {
  value = aws_route_table.pl_rt.id
}

output "private_rt" {
  value = aws_route_table.pr_rt[*].id
}

output "availability_zones" {
  value = var.availability_zones
}

output "eks_subnet_ids" {
  description = "Private subnets for the EKS control plane ENIs and managed node groups."
  value       = local.privateSubnets
}

output "nat_gateway_ids" {
  value = aws_nat_gateway.ngw[*].id
}

output "ecr_repository_urls" {
  description = "Docker push/pull URLs keyed by repository name."
  value       = { for name, repository in aws_ecr_repository.services : name => repository.repository_url }
}

output "ecr_repository_arns" {
  description = "Repository ARNs for scoping CI publishing and EKS pulling IAM permissions."
  value       = { for name, repository in aws_ecr_repository.services : name => repository.arn }
}
