# Offline tests: the AWS provider is mocked, so no credentials are used and nothing is created.
#   terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
      arn        = "arn:aws:iam::111122223333:user/test"
    }
  }
  mock_data "aws_iam_session_context" {
    defaults = { issuer_arn = "arn:aws:iam::111122223333:user/test" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:xx-test-1:111122223333:key/mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:xx-test-1:111122223333:log-group:mock" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { arn = "arn:aws:ecr:xx-test-1:111122223333:repository/mock" }
  }
  mock_data "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:xx-test-1:111122223333:repository/mock"
      repository_url = "111122223333.dkr.ecr.xx-test-1.amazonaws.com/mock"
    }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:xx-test-1:111122223333:mock" }
  }
  mock_resource "aws_eks_cluster" {
    defaults = { arn = "arn:aws:eks:xx-test-1:111122223333:cluster/mock" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["xx-test-1a", "xx-test-1b"] }
  }
}

variables {
  region                  = "xx-test-1"
  name                    = "roboshop-test"
  owner                   = "test"
  availability_zones      = ["xx-test-1a", "xx-test-1b"]
  api_public_access_cidrs = ["203.0.113.10/32"]
}

run "demo_defaults" {
  command = plan

  assert {
    condition     = alltrue([for r in aws_ecr_repository.app : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "ECR tags must be immutable"
  }
  assert {
    condition     = alltrue([for r in aws_ecr_repository.app : r.image_scanning_configuration[0].scan_on_push])
    error_message = "ECR scan on push must be on"
  }
  assert {
    condition     = length(aws_ecr_repository.app) == 11
    error_message = "one repository per service image"
  }
  assert {
    condition     = !contains(keys(aws_iam_role.pod_identity), "cert-manager") && !contains(keys(aws_iam_role.pod_identity), "moks")
    error_message = "optional DNS and Bedrock roles must not exist by default"
  }
  assert {
    condition     = length(aws_iam_role.github_ecr_push) == 0
    error_message = "no CI role unless github_repository is set"
  }
  assert {
    condition     = aws_cloudwatch_log_group.applications.retention_in_days == 30
    error_message = "application logs need finite retention"
  }
  assert {
    condition     = aws_secretsmanager_secret.app.name == "roboshop/demo/app"
    error_message = "secret name must follow <prefix>/<environment>/app"
  }
}

run "optional_integrations" {
  command = plan

  variables {
    route53_zone_id    = "Z0000000000000000000"
    bedrock_model_arns = ["arn:aws:bedrock:xx-test-1::foundation-model/example"]
    github_repository  = "example/roboshop-ai"
  }

  assert {
    condition     = contains(keys(aws_eks_pod_identity_association.this), "cert-manager") && contains(keys(aws_eks_pod_identity_association.this), "moks")
    error_message = "cert-manager and moks associations must be created when configured"
  }
  assert {
    condition     = aws_eks_pod_identity_association.this["moks"].namespace == "roboshop-ai" && aws_eks_pod_identity_association.this["moks"].service_account == "moks"
    error_message = "Bedrock access is bound to roboshop-ai/moks only"
  }
  assert {
    condition     = length(aws_iam_role.github_ecr_push) == 1
    error_message = "CI role expected"
  }
}

run "reuses_existing_repositories" {
  command = plan

  variables {
    manage_ecr_repositories = false
  }

  assert {
    condition     = length(aws_ecr_repository.app) == 0 && length(data.aws_ecr_repository.existing) == 11
    error_message = "existing repositories must be looked up, not created"
  }
}

run "rejects_open_api" {
  command = plan

  variables {
    api_public_access_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.api_public_access_cidrs]
}

run "rejects_bad_name" {
  command = plan

  variables {
    name = "RoboShop_Demo"
  }

  expect_failures = [var.name]
}
