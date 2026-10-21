resource "aws_vpc" "vpc" {
  cidr_block           = var.vpc_cidr
  instance_tenancy     = "default"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc-${var.environment}"
  })
  lifecycle {
    precondition {
      condition     = alltrue([for az in var.availability_zones : contains(data.aws_availability_zones.azs.names, az)])
      error_message = "All selected AZs must be available standard zones in aws_region."
    }
  }
}
