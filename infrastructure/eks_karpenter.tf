# IAM Role
resource "aws_iam_role" "karpenter_controller" {
  description        = "IAM Role for Karpenter Controller (pod) to assume"
  name               = "${local.name_prefix}-karpenter-controller-role-${local.name_suffix}"
  assume_role_policy = data.aws_iam_policy_document.karpenter_controller_assume_role.json
}

resource "aws_iam_role_policy" "karpenter_controller_role_policy" {
  name   = "${local.name_prefix}-karpenter-controller-role-policy-${local.name_suffix}"
  role   = aws_iam_role.karpenter_controller.name
  policy = data.aws_iam_policy_document.karpenter_controller_role_policy.json
}

# IRSA policy
data "aws_iam_policy_document" "karpenter_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    condition {
      test     = "StringEquals"
      values   = ["system:serviceaccount:karpenter:karpenter"]
      variable = replace("${data.aws_eks_cluster.cluster.identity.0.oidc.0.issuer}:sub", "https://", "") #"${module.eks_cap_dev.cluster_oidc_issuer}:sub"
    }
    condition {
      test     = "StringEquals"
      values   = ["sts.amazonaws.com"]
      variable = replace("${data.aws_eks_cluster.cluster.identity.0.oidc.0.issuer}:aud", "https://", "") #"${module.eks_cap_dev.cluster_oidc_issuer}:aud"
    }
    principals {
      type        = "Federated"
      identifiers = [replace("arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${data.aws_eks_cluster.cluster.identity.0.oidc.0.issuer}", "https://", "")] #["${module.eks_cap_dev.iam_oidc_provider_arn}"]
    }
  }
}

# Inline policy
data "aws_iam_policy_document" "karpenter_controller_role_policy" {
  statement {
    resources = ["*"]
    actions = [
      "ssm:GetParameter",
      "iam:PassRole",
      "ec2:DescribeImages",
      "ec2:RunInstances",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeLaunchTemplates",
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeInstanceTypeOfferings",
      "ec2:DescribeAvailabilityZones",
      "ec2:DeleteLaunchTemplate",
      "ec2:CreateTags",
      "ec2:CreateLaunchTemplate",
      "ec2:CreateFleet",
      "ec2:DescribeSpotPriceHistory",
      "pricing:GetProducts"
    ]
    effect = "Allow"
  }
  statement {
    resources = ["*"]
    actions   = ["ec2:TerminateInstances", "ec2:DeleteLaunchTemplate"]
    effect    = "Allow"
    # Make sure Karpenter can only delete nodes that it has provisioned
    condition {
      test     = "StringLike"
      variable = "ec2:ResourceTag/Name"
      values   = ["*karpenter*"]
    }
  }
  #   statement {
  #     resources = ["arn:aws:eks:eu-west-1:858768110039:cluster/jith-eks"]
  #     actions   = ["eks:DescribeCluster"]
  #     effect    = "Allow"
  #   }
  #   statement {
  #     resources = [aws_iam_role.eks_node.arn]
  #     actions   = ["iam:PassRole"]
  #     effect    = "Allow"
  #   }
  # Optional: Interrupt Termination Queue permissions, provided by AWS SQS
  statement {
    resources = [aws_sqs_queue.karpenter_sqs_queue.arn]
    actions   = ["sqs:DeleteMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"]
    effect    = "Allow"
  }
}

# Instance profile
resource "aws_iam_instance_profile" "karpenter_instance_profile" {
  name = "-${local.name_prefix}karpenter-insprof-${local.name_suffix}"
  role = aws_iam_role.eks_node.name
}

data "aws_iam_policy" "eks_worker_node" {
  arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

data "aws_iam_policy" "eks_cni_policy" {
  arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

data "aws_iam_policy" "ecr_read_only" {
  arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

data "aws_iam_policy" "ssm_managed_instance" {
  arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# IAM Role
resource "aws_iam_role" "eks_node" {
  description = "IAM Role for Karpenter's InstanceProfile to use when launching nodes"
  name        = "${local.name_prefix}-karpenter-node-role-${local.name_suffix}"
  managed_policy_arns = [
    data.aws_iam_policy.eks_worker_node.arn,
    data.aws_iam_policy.eks_cni_policy.arn,
    data.aws_iam_policy.ecr_read_only.arn,
    data.aws_iam_policy.ssm_managed_instance.arn
  ]
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          "Service" : "ec2.amazonaws.com"
        },
      }
    ]
  })
}

resource "helm_release" "karpenter" {
  depends_on       = [aws_iam_role_policy.karpenter_controller_role_policy]
  name             = "karpenter"
  repository       = "oci://public.ecr.aws/karpenter"
  chart            = "karpenter"
  namespace        = "karpenter"
  create_namespace = true
  version          = "v0.28.0"
  wait             = true
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.karpenter_controller.arn
  }
  set {
    name  = "settings.aws.clusterName"
    value = local.cluster_name
  }
  set {
    name  = "settings.aws.clusterEndpoint"
    value = local.cluster_endpoint
  }
  set {
    name  = "defaultProvisioner.create"
    value = false
  }
  set {
    name  = "settings.aws.defaultInstanceProfile"
    value = aws_iam_instance_profile.karpenter_instance_profile.name
  }
  set {
    name  = "settings.aws.interruptionQueueName"
    value = aws_sqs_queue.karpenter_sqs_queue.name
  }
  set {
    name  = "logLevel"
    value = "debug"
  }
}

resource "helm_release" "karpenter_provisioner" {
  depends_on = [helm_release.karpenter]
  chart      = "./helmcharts/karpenter"
  name       = "${local.name_prefix}-karpenter-provisioner-${local.name_suffix}"
  namespace  = helm_release.karpenter.namespace
}
