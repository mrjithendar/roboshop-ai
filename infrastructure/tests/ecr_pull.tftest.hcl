mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
}
variables {
  environment        = "test"
  availability_zones = ["us-east-1a", "us-east-1b"]
}
run "no_grants_by_default" {
  command = plan
  assert {
    condition     = length(aws_ecr_repository_policy.pull) == 0
    error_message = "No external accounts should have access by default."
  }
}
run "mcp_pull_only" {
  command = plan
  variables {
    ecr_pull_principals = {
      "roboshop-mcp-server" = ["arn:aws:iam::881026659929:root"]
    }
  }
  assert {
    condition     = length(aws_ecr_repository_policy.pull) == 1 && jsondecode(aws_ecr_repository_policy.pull["roboshop-mcp-server"].policy).Statement[0].Principal.AWS == ["arn:aws:iam::881026659929:root"] && toset(jsondecode(aws_ecr_repository_policy.pull["roboshop-mcp-server"].policy).Statement[0].Action) == toset(["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"])
    error_message = "The configured account must receive only image pull permissions on the MCP repository."
  }
}
run "reject_wildcard_principal" {
  command = plan
  variables {
    ecr_pull_principals = { "roboshop-mcp-server" = ["*"] }
  }
  expect_failures = [var.ecr_pull_principals]
}
