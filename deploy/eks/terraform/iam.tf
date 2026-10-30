# Workload permissions use EKS Pod Identity (not IRSA): no per-cluster OIDC trust policies to
# rewrite, roles are reusable across clusters, and every controller used here supports it.
# Each role is bound to exactly one namespace/service account.
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  secret_arn = "arn:${local.partition}:secretsmanager:${var.region}:${local.account_id}:secret:${var.secrets_prefix}/${var.environment}/*"

  pod_identities = merge(
    {
      ebs-csi = {
        namespace       = "kube-system"
        service_account = "ebs-csi-controller-sa"
        managed_policy  = "arn:${local.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
        policy          = null
        associate       = false # the EKS add-on creates this association itself (eks.tf)
      }
      aws-load-balancer-controller = {
        namespace       = "kube-system"
        service_account = "aws-load-balancer-controller"
        managed_policy  = null
        policy          = file("${path.module}/policies/aws-load-balancer-controller-v3.6.2.json")
        associate       = true
      }
      external-secrets = {
        namespace       = "external-secrets"
        service_account = "external-secrets"
        managed_policy  = null
        policy = jsonencode({
          Version = "2012-10-17"
          Statement = [{
            Sid      = "ReadRoboShopSecrets"
            Effect   = "Allow"
            Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
            Resource = local.secret_arn
          }]
        })
        associate = true
      }
      otel-agent = {
        namespace       = "observability"
        service_account = "otel-agent"
        managed_policy  = null
        policy = jsonencode({
          Version = "2012-10-17"
          Statement = [{
            Sid      = "WriteContainerLogs"
            Effect   = "Allow"
            Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
            Resource = ["${aws_cloudwatch_log_group.applications.arn}", "${aws_cloudwatch_log_group.applications.arn}:*"]
          }]
        })
        associate = true
      }
    },
    var.route53_zone_id == "" ? {} : {
      cert-manager = {
        namespace       = "cert-manager"
        service_account = "cert-manager"
        managed_policy  = null
        policy = jsonencode({
          Version = "2012-10-17"
          Statement = [
            {
              Sid      = "Dns01Challenge"
              Effect   = "Allow"
              Action   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"]
              Resource = "arn:${local.partition}:route53:::hostedzone/${var.route53_zone_id}"
            },
            {
              Sid      = "ChangeStatus"
              Effect   = "Allow"
              Action   = ["route53:GetChange"]
              Resource = "arn:${local.partition}:route53:::change/*"
            },
            {
              Sid      = "ZoneLookup"
              Effect   = "Allow"
              Action   = ["route53:ListHostedZonesByName"]
              Resource = "*"
            },
          ]
        })
        associate = true
      }
    },
    length(var.bedrock_model_arns) == 0 ? {} : {
      moks = {
        namespace       = "roboshop-ai"
        service_account = "moks"
        managed_policy  = null
        policy = jsonencode({
          Version = "2012-10-17"
          Statement = [{
            Sid      = "InvokeApprovedModels"
            Effect   = "Allow"
            Action   = ["bedrock:InvokeModel", "bedrock:Converse"]
            Resource = var.bedrock_model_arns
          }]
        })
        associate = true
      }
    },
  )
}

data "aws_iam_policy_document" "pod_identity_trust" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "pod_identity" {
  for_each = local.pod_identities

  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

resource "aws_iam_role_policy_attachment" "pod_identity_managed" {
  for_each = { for k, v in local.pod_identities : k => v if v.managed_policy != null }

  role       = aws_iam_role.pod_identity[each.key].name
  policy_arn = each.value.managed_policy
}

resource "aws_iam_role_policy" "pod_identity_inline" {
  for_each = { for k, v in local.pod_identities : k => v if v.policy != null }

  name   = each.key
  role   = aws_iam_role.pod_identity[each.key].id
  policy = each.value.policy
}

resource "aws_eks_pod_identity_association" "this" {
  for_each = { for k, v in local.pod_identities : k => v if v.associate }

  cluster_name    = module.eks.cluster_name
  namespace       = each.value.namespace
  service_account = each.value.service_account
  role_arn        = aws_iam_role.pod_identity[each.key].arn
}
