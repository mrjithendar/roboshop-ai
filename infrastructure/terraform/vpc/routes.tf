resource "aws_route_table" "pl_rt" {
  vpc_id = aws_vpc.vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-public-rt-${var.environment}",
    "Purpose" = "${local.common_tags["Team"]} public route table"
  })))
}

#Public route table associations
resource "aws_route_table_association" "pl_rta" {
  count          = length(local.publicSubnets)
  subnet_id      = element(local.publicSubnets, count.index)
  route_table_id = aws_route_table.pl_rt.id
}

resource "aws_route_table" "pr_rt" {
  count  = length(aws_nat_gateway.ngw)
  vpc_id = aws_vpc.vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_nat_gateway.ngw[count.index].id
  }
  lifecycle {
    ignore_changes = [ tags ]
  }
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-private-rt-${count.index + 1}-${var.environment}",
    "Purpose" = "${local.common_tags["Team"]} private route table"
  })))
}

# Private route table associations
resource "aws_route_table_association" "pr_rta" {
  count          = length(local.privateSubnets)
  subnet_id      = element(local.privateSubnets, count.index)
  route_table_id = aws_route_table.pr_rt[count.index].id
}

