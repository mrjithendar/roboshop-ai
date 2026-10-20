locals {
  common_tags = merge(var.tags, {
    Project     = "robotshop-ai"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }, var.userid != "" ? { Owner = var.userid } : {})
  name_prefix    = "robotshop"
  privateSubnets = aws_subnet.vpc_private_subnets[*].id
  publicSubnets  = aws_subnet.vpc_public_subnets[*].id
  subnets        = concat(local.privateSubnets, local.publicSubnets)
  nat_count      = var.single_nat_gateway ? 1 : length(var.availability_zones)
}
