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
