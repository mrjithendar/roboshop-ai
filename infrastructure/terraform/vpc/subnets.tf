resource "random_shuffle" "az_list" {
  input        = data.aws_availability_zones.azs.names
  result_count = 2
}

resource "aws_subnet" "vpc_private_subnets" {
  count                   = random_shuffle.az_list.result_count
  vpc_id                  = aws_vpc.vpc.id
  availability_zone       = random_shuffle.az_list.result[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-private-subnet-${var.environment}-${count.index + 1}",
    "Purpose" = "${local.common_tags["Team"]} multi AZ private subnets"
  })))
}

resource "aws_subnet" "vpc_public_subnets" {
  count                   = random_shuffle.az_list.result_count
  vpc_id                  = aws_vpc.vpc.id
  availability_zone       = random_shuffle.az_list.result[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 2)
  map_public_ip_on_launch = true
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-public-subnet-${var.environment}-${count.index + 1}",
    "Purpose" = "${local.common_tags["Team"]} multi AZ public subnets"
  })))
}