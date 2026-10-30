locals {
  tags = {
    Project     = "roboshop-ai"
    Environment = var.environment
    Owner       = var.owner
    ManagedBy   = "terraform"
    Stack       = var.name
  }

  # /19 private subnets leave room for VPC CNI pod IPs; /24 public subnets hold only NLB and NAT ENIs.
  private_subnets = [for i, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 3, i)]
  public_subnets  = [for i, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 8, 240 + i)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = var.name
  cidr = var.vpc_cidr
  azs  = var.availability_zones

  private_subnets = local.private_subnets
  public_subnets  = local.public_subnets

  # Worker nodes and pods have no public IPs. All internet egress (ECR auth, STS, AWS APIs not
  # covered by endpoints, Razorpay, Bedrock, Let's Encrypt, GitHub) leaves through NAT.
  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  enable_dns_hostnames    = true
  enable_dns_support      = true
  map_public_ip_on_launch = false

  # Load balancer subnet discovery (AWS Load Balancer Controller) and Karpenter subnet discovery.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
    "karpenter.sh/discovery"          = var.name
  }

  enable_flow_log = false # Turn on for production; flow logs are a CloudWatch cost driver.
}

module "vpc_endpoints" {
  source  = "terraform-aws-modules/vpc/aws//modules/vpc-endpoints"
  version = "6.7.3"

  vpc_id = module.vpc.vpc_id

  create_security_group      = var.enable_interface_endpoints
  security_group_name_prefix = "${var.name}-endpoints-"
  security_group_description = "HTTPS from inside the VPC to interface endpoints"
  security_group_rules = {
    ingress_https = {
      description = "HTTPS from the VPC"
      cidr_blocks = [module.vpc.vpc_cidr_block]
    }
  }

  endpoints = merge(
    {
      # Gateway endpoint: free, and carries ECR image layers (stored in S3) off the NAT gateway.
      s3 = {
        service         = "s3"
        service_type    = "Gateway"
        route_table_ids = module.vpc.private_route_table_ids
        tags            = { Name = "${var.name}-s3" }
      }
    },
    var.enable_interface_endpoints ? {
      for svc in ["ecr.api", "ecr.dkr", "sts", "logs", "secretsmanager", "sqs", "ec2"] :
      replace(svc, ".", "_") => {
        service             = svc
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        tags                = { Name = "${var.name}-${svc}" }
      }
    } : {}
  )
}
