# Separate root module from ../../../infrastructure (the lab VPC/ECR/SES stack), so a reader's
# EKS environment never shares state, names or personal values with the original lab.
terraform {
  required_version = ">= 1.10, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }

  # Partial configuration: supply bucket/key/region with -backend-config=backend.hcl
  # (copy backend.hcl.example). Never commit a filled-in backend.hcl.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}
