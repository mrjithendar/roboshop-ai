variable "environment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,19}$", var.environment))
    error_message = "Use a lowercase environment name, up to 20 characters."
  }
}

variable "userid" {
  description = "Owner identifier for resource tags (not an AWS credential)."
  type        = string
  default     = ""
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  description = "IPv4 /16 network, checked against existing networks before peering."
  type        = string
  default     = "10.0.0.0/16"
  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && can(regex("/16$", var.vpc_cidr))
    error_message = "Provide an IPv4 /16 CIDR for this subnet layout."
  }
}

variable "availability_zones" {
  description = "Two or three distinct standard AZs in aws_region, in stable order. Changing order replaces subnets."
  type        = list(string)
  validation {
    condition     = length(var.availability_zones) >= 2 && length(var.availability_zones) <= 3 && length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "Specify two or three distinct availability zones."
  }
}

variable "single_nat_gateway" {
  description = "Cost-saving demo option. True routes all private subnets via the first AZ and loses AZ-level egress redundancy."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional organizational tags."
  type        = map(string)
  default     = {}
}

variable "ecr_repository_names" {
  description = "Private ECR repository names. Defaults match the service image names and CI's roboshop prefix. Use [] to manage no repositories."
  type        = list(string)
  nullable    = false
  default = [
    "roboshop-ai-gateway",
    "roboshop-cart-service",
    "roboshop-catalogue-service",
    "roboshop-finder",
    "roboshop-currency-service",
    "roboshop-fastapi-demo",
    "roboshop-frontend",
    "roboshop-mcp-server",
    "roboshop-nginx",
    "roboshop-payment-service",
    "roboshop-product-ingestion",
    "roboshop-recommendation-service",
    "roboshop-shipping",
    "roboshop-shopping-agent",
    # "roboshop-smtp-server",
    "roboshop-user-service",
    "roboshop-sre-copilot",
  ]

  validation {
    condition     = length(distinct(var.ecr_repository_names)) == length(var.ecr_repository_names)
    error_message = "ECR repository names must be unique."
  }

  validation {
    condition = alltrue([
      for name in var.ecr_repository_names :
      length(name) >= 2 && length(name) <= 256 && can(regex("^[a-z][a-z0-9]*([._/-][a-z0-9]+)*$", name))
    ])
    error_message = "Use 2–256 character lowercase repository names starting with a letter; separate alphanumeric segments with a dot, underscore, hyphen or slash."
  }
}

variable "ses_enabled" {
  description = "Provision SES domain verification and a restricted SMTP IAM user. DNS verification is managed separately."
  type        = bool
  default     = false
}

variable "ses_domain" {
  description = "Domain used for transactional emails."
  type        = string
  default     = "jithendar.com"
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.ses_domain))
    error_message = "Provide a lowercase DNS domain, without a scheme or path."
  }
}
