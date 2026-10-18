# Terraform

The active EKS-ready VPC stack is at repository-root [`vpc/`](../../vpc/README.md).
It provides private/public subnets across two or three AZs, NAT egress, an S3
gateway endpoint, and EKS subnet outputs. Read its deployment and existing-state
migration notes before planning. EKS cluster provisioning is a separate next step;
this stack does not create a cluster. No cloud resources were applied by the review.
