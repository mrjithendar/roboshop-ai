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
  value = random_shuffle.az_list.result
}