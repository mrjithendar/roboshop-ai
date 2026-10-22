# Optional role for the external Hetzner workload. No access keys are generated.
# Supply an existing IAM user/role ARN; an external pod cannot assume an AWS role
# without a source credential or federation mechanism.
variable "bedrock_trusted_principal_arns" {
  description = "Existing IAM user/role ARNs allowed to assume the shopping-agent role. Empty disables creation. Never use STS session ARNs."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.bedrock_trusted_principal_arns : can(regex("^arn:aws:iam::[0-9]{12}:(user|role)/[A-Za-z0-9+=,.@_/-]+$", arn))])
    error_message = "Provide exact IAM user or role ARNs, not wildcard, root, or STS session principals."
  }
}

variable "bedrock_inference_profile_id" {
  description = "US inference profile allowed for the shopping agent. Change together with model ID."
  type        = string
  default     = "us.amazon.nova-2-lite-v1:0"
  validation {
    condition     = can(regex("^us\\.[a-zA-Z0-9.:-]+$", var.bedrock_inference_profile_id))
    error_message = "Use an exact US inference profile ID."
  }
}

variable "bedrock_model_id" {
  type    = string
  default = "amazon.nova-2-lite-v1:0"
  validation {
    condition     = can(regex("^[a-zA-Z0-9.:-]+$", var.bedrock_model_id))
    error_message = "Use an exact foundation model ID, without wildcards."
  }
}

data "aws_caller_identity" "bedrock" {}

locals {
  bedrock_enabled     = length(var.bedrock_trusted_principal_arns) > 0
  bedrock_profile_arn = "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.bedrock.account_id}:inference-profile/${var.bedrock_inference_profile_id}"
}

resource "aws_iam_role" "shopping_agent_bedrock" {
  count                = local.bedrock_enabled ? 1 : 0
  name                 = "${local.name_prefix}-${var.environment}-shopping-agent-bedrock"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { AWS = sort(tolist(var.bedrock_trusted_principal_arns)) }
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "shopping_agent_bedrock" {
  count = local.bedrock_enabled ? 1 : 0
  name  = "invoke-selected-bedrock-profile"
  role  = aws_iam_role.shopping_agent_bedrock[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeSelectedProfile"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = local.bedrock_profile_arn
      },
      {
        Sid    = "InvokeProfileDestinationModels"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        # Geographic inference can route among US destinations. Restrict both
        # the exact model and the profile; direct foundation-model calls fail.
        Resource = "arn:aws:bedrock:us-*::foundation-model/${var.bedrock_model_id}"
        Condition = {
          StringEquals = { "bedrock:InferenceProfileArn" = local.bedrock_profile_arn }
        }
      }
    ]
  })
}

output "shopping_agent_bedrock_role_arn" {
  description = "Role ARN for an AWS SDK assume-role profile; null when disabled."
  value       = try(aws_iam_role.shopping_agent_bedrock[0].arn, null)
}
