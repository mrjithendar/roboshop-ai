resource "aws_vpc_peering_connection" "vpc_peering" {
  peer_vpc_id = aws_vpc.vpc.id
  vpc_id      = data.aws_vpc.default.id
  auto_accept = true
  tags = (merge(local.common_tags, tomap({
    "Name"    = "${local.name_prefix}-vpc-${var.environment}",
    "Purpose" = "vpc for ${local.common_tags["Team"]}"
  })))
}