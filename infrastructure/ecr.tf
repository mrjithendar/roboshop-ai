# Repository names are stable resource keys: reordering the list does not replace them.
resource "aws_ecr_repository" "services" {
  for_each = toset(var.ecr_repository_names)

  name                 = each.value
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = false
  }

  tags = merge(local.common_tags, {
    Name = each.value
  })
}

# Cross-account grants are limited to explicitly configured repositories.
resource "aws_ecr_repository_policy" "pull" {
  for_each   = var.ecr_pull_principals
  repository = aws_ecr_repository.services[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCrossAccountPull"
      Effect    = "Allow"
      Principal = { AWS = each.value }
      Action = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
      ]
    }]
  })
}
