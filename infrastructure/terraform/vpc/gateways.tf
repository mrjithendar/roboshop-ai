resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.vpc.id
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-igw-${var.environment}",
    "Purpose" = "igw for ${local.common_tags["Team"]}"
  })))
}

resource "aws_eip" "eip" {
  count       = length(aws_subnet.vpc_public_subnets)
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-eip-${count.index + 1}-${var.environment}",
    "Purpose" = "${local.common_tags["Team"]} eip"
  })))
}

resource "aws_nat_gateway" "ngw" {
  count             = length(aws_subnet.vpc_private_subnets)
  connectivity_type = "public"
  allocation_id     = aws_eip.eip[count.index].id
  subnet_id         = local.publicSubnets[count.index]
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-ngw-${count.index + 1}-${var.environment}",
    "Purpose" = "${local.common_tags["Team"]} nat gateway"
  })))
  # To ensure proper ordering, it is recommended to add an explicit dependency
  # on the Internet Gateway for the VPC.
  depends_on = [aws_internet_gateway.igw]
}