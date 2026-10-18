resource "aws_vpc" "vpc" {
  cidr_block       = var.vpc_cidr
  instance_tenancy = "default"
  # Must be enabled for EFS
  enable_dns_support   = true
  enable_dns_hostnames = true
  lifecycle {
    create_before_destroy = true
  }
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-vpc-${var.environment}",
    "Purpose" = "vpc for ${local.common_tags["Team"]}"
  })))
}