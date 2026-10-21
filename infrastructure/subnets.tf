# /20 private networks provide room for node and VPC CNI pod addresses.
resource "aws_subnet" "vpc_private_subnets" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.vpc.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, {
    Name                              = "${local.name_prefix}-private-subnet-${var.environment}-${count.index + 1}"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

# /24 public networks are outside the private /20 ranges; used by NAT and public LBs.
resource "aws_subnet" "vpc_public_subnets" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.vpc.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 240 + count.index)
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, {
    Name                     = "${local.name_prefix}-public-subnet-${var.environment}-${count.index + 1}"
    "kubernetes.io/role/elb" = "1"
  })
}
