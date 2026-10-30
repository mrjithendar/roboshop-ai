# Immutable tags: CI pushes the commit SHA as the tag and deployments pin the digest, so a
# running image can never change underneath a Deployment. (The lab stack in
# ../../../infrastructure keeps MUTABLE tags for its :latest workflow.)
resource "aws_ecr_repository" "app" {
  for_each = var.manage_ecr_repositories ? toset(var.ecr_repositories) : toset([])

  name                 = "${var.ecr_repository_prefix}-${each.value}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

data "aws_ecr_repository" "existing" {
  for_each = var.manage_ecr_repositories ? toset([]) : toset(var.ecr_repositories)
  name     = "${var.ecr_repository_prefix}-${each.value}"
}

locals {
  ecr_repositories = var.manage_ecr_repositories ? {
    for k, r in aws_ecr_repository.app : k => { arn = r.arn, url = r.repository_url }
    } : {
    for k, r in data.aws_ecr_repository.existing : k => { arn = r.arn, url = r.repository_url }
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 most recent images (rollback window)"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}
