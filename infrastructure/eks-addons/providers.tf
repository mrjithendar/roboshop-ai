terraform {
  required_version = ">= 1.10, < 2.0"
  backend "s3" {
    bucket       = "jithendardharmapuri"
    key          = "terraform/eks-addons.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 6.0" }
    helm       = { source = "hashicorp/helm", version = "~> 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.0" }
  }
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "cluster_name" {
  type    = string
  default = "roboshop-demo"
}
provider "aws" { region = var.aws_region }
data "aws_eks_cluster" "main" { name = var.cluster_name }
provider "kubernetes" {
  host                   = data.aws_eks_cluster.main.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.aws_region]
  }
}
provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.main.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.aws_region]
    }
  }
}
