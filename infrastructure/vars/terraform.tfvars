environment        = "demo"
userid             = "JDHARMAPURI"
aws_region         = "us-east-1"
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]
# False = one NAT per AZ. True reduces demo costs but makes egress depend on one AZ.
single_nat_gateway = false

ses_enabled = true
ses_domain  = "jithendar.com"

# Minikube's current ECR caller; grant pull access only to the MCP repository.
# Replace with a dedicated role ARN when the runner uses an IAM role.
ecr_pull_principals = {
  "roboshop-mcp-server" = ["arn:aws:iam::881026659929:root"]
}
