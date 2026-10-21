terraform {
  backend "s3" {
    bucket = "jithendar"
    key    = "terraform/demo_eks_resources"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "jith" {
  backend = "s3"
  config = {
    bucket = "jithendar"
    key    = "terraform/demo"
    region = "us-east-1"
  }
}