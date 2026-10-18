data "aws_vpc" "default" {
  filter {
    name   = "tag:Name"
    values = ["Default"]
  }
}

data "aws_availability_zones" "azs" {
  state         = "available"
  exclude_names = ["us-east-1e"] #, "us-east-1f", "us-east-1c", "us-east-1d"]
}