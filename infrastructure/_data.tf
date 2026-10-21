data "aws_availability_zones" "azs" {
  state = "available"
  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}

data "aws_region" "current" {}
