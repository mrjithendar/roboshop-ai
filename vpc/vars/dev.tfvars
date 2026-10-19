environment        = "demo"
userid             = "JDHARMAPURI"
aws_region         = "us-east-1"
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]
# False = one NAT per AZ. True reduces demo costs but makes egress depend on one AZ.
single_nat_gateway = false
