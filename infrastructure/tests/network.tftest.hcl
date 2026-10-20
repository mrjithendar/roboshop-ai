mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b", "us-east-1c"]
    }
  }
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
}

variables {
  environment        = "test"
  availability_zones = ["us-east-1a", "us-east-1b"]
}

run "multi_az" {
  command = plan
  assert {
    condition     = length(aws_nat_gateway.ngw) == 2 && length(aws_route_table.pr_rt) == 2
    error_message = "Default egress must have one NAT and private route table per AZ."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.vpc_private_subnets : !s.map_public_ip_on_launch && s.tags["kubernetes.io/role/internal-elb"] == "1"])
    error_message = "Private subnets must not assign public IPs and must advertise internal load balancers."
  }
  assert {
    condition     = aws_subnet.vpc_private_subnets[0].cidr_block == "10.0.0.0/20" && aws_subnet.vpc_public_subnets[0].cidr_block == "10.0.240.0/24"
    error_message = "Private and public subnet ranges must follow the non-overlapping layout."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.vpc_public_subnets : s.tags["kubernetes.io/role/elb"] == "1"])
    error_message = "Public subnets must advertise public load balancers."
  }
}

run "single_nat_three_azs" {
  command = plan
  variables {
    single_nat_gateway = true
    availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
  }
  assert {
    condition     = length(aws_nat_gateway.ngw) == 1 && length(aws_route_table.pr_rt) == 3 && length(aws_subnet.vpc_private_subnets) == 3
    error_message = "Single NAT must retain a private route table and subnet in every AZ."
  }
}

run "reject_one_az" {
  command = plan
  variables {
    availability_zones = ["us-east-1a"]
  }
  expect_failures = [var.availability_zones]
}

run "reject_wrong_region_az" {
  command = plan
  variables {
    availability_zones = ["us-east-1a", "us-west-2a"]
  }
  expect_failures = [aws_vpc.vpc]
}

run "reject_small_vpc" {
  command = plan
  variables {
    vpc_cidr = "10.0.0.0/24"
  }
  expect_failures = [var.vpc_cidr]
}
