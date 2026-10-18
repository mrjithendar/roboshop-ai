locals {
  common_tags = merge(local.our_tags, var.userid != "" ? tomap({ "Role" = trimprefix("Trainer", "-") }) : tomap({}))
  our_tags = {
    Team         = "DKODE Tech"
    Email        = "team@decodedevops.com"
    Environment  = var.environment
    Organization = "Decode DevOps"
    Createdby    = "Terraform"
  }
  name_prefix    = "roboshop"
  name_suffix    = var.environment
  privateSubnets = aws_subnet.vpc_private_subnets.*.id
  publicSubnets  = aws_subnet.vpc_public_subnets.*.id
  subnets        = concat(aws_subnet.vpc_private_subnets.*.id, aws_subnet.vpc_public_subnets.*.id)
}
