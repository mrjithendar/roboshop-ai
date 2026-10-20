mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
}

variables {
  environment        = "test"
  availability_zones = ["us-east-1a", "us-east-1b"]
}

run "custom_repository_list" {
  command = plan
  variables {
    ecr_repository_names = ["team/frontend", "team/api"]
  }
  assert {
    condition     = toset(keys(aws_ecr_repository.services)) == toset(["team/frontend", "team/api"])
    error_message = "A custom list must replace defaults and use repository names as stable keys."
  }
  assert {
    condition     = alltrue([for repository in aws_ecr_repository.services : repository.image_tag_mutability == "IMMUTABLE" && !repository.force_delete])
    error_message = "Published tags must be immutable and populated repositories must resist deletion."
  }
}

run "empty_repository_list" {
  command = plan
  variables {
    ecr_repository_names = []
  }
  assert {
    condition     = length(aws_ecr_repository.services) == 0
    error_message = "An empty list must create no repositories."
  }
}

run "reject_duplicate_repositories" {
  command = plan
  variables {
    ecr_repository_names = ["robotshop-api", "robotshop-api"]
  }
  expect_failures = [var.ecr_repository_names]
}

run "reject_invalid_repository_name" {
  command = plan
  variables {
    ecr_repository_names = ["RobotShop API"]
  }
  expect_failures = [var.ecr_repository_names]
}
