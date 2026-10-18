terraform {
  backend "s3" {
    bucket = "jithendardharmapuri"
    key    = "terraform/vpc.tfstate"
    region = "us-east-1"
  }
}