resource "aws_iam_role" "adot_role" {
  name               = "${local.name_prefix}-eks-adot-role-${local.name_suffix}"
  assume_role_policy = data.aws_iam_policy_document.adot_assume_role_policy.json
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-eks-adot-role-${local.name_suffix}"
  })
}

data "aws_iam_policy_document" "adot_assume_role_policy" {
  # Trust Relationships
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "adot_prometheus" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess"
  role       = aws_iam_role.adot_role.id
}

resource "aws_iam_role_policy_attachment" "adot_xray" {
  policy_arn = "arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess"
  role       = aws_iam_role.adot_role.id
}

resource "aws_iam_role_policy_attachment" "adot_cloudwatch" {
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
  role       = aws_iam_role.adot_role.id
}

resource "kubernetes_namespace" "operator" {
  metadata {
    name = "opentelemetry-operator-system"
    labels = {
      "control-plane" = "controller-manager"
    }
  }
}

resource "kubernetes_namespace" "adot" {
  metadata {
    name = "adot"
  }
}

resource "kubernetes_service_account" "adot_collector" {
  metadata {
    name      = "adot-collector"
    namespace = kubernetes_namespace.adot.metadata.0.name
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.adot_role.arn
    }
  }
}

resource "aws_eks_addon" "adot" {
  depends_on   = [helm_release.cert_manager]
  addon_name   = "adot"
  cluster_name = module.eks_cap_dev.cluster_name
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-adot-addon-${local.name_suffix}"
  })
}

resource "kubernetes_cluster_role" "adot" {
  metadata {
    name = "${local.name_prefix}-adot-cloudwatch-cluster-role-${local.name_suffix}"
  }
  rule {
    api_groups = [""]
    resources = ["nodes", "nodes/proxy", "services", "endpoints", "pods"]
    verbs = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["extensions"]
    resources = ["ingresses"]
    verbs = ["get", "list", "watch"]
  }
  rule {
    non_resource_urls = ["/metrics"]
    verbs = ["get"]
  }
}

resource "kubernetes_cluster_role_binding" "adot" {
  depends_on = [aws_eks_addon.adot, kubernetes_cluster_role.adot]
  metadata {
    name = "${local.name_prefix}-adot-cloudwatch-cluster-role-binding-${local.name_suffix}"
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = "adot-cluster-role-binding"
  }
  subject {
    kind = "ServiceAccount"
    name = kubernetes_service_account.adot_collector.metadata.0.name
    namespace = kubernetes_namespace.adot.metadata.0.name
  }
}

resource "helm_release" "adot_collector_cw" {
  depends_on = [aws_eks_addon.adot, kubernetes_cluster_role_binding.adot]
  chart      = "./helmcharts/adotcloudwatch"
  name       = "${local.name_prefix}-adot-cloudwatch-collector-${local.name_suffix}"
  namespace = kubernetes_namespace.adot.metadata.0.name
}

resource "helm_release" "adot_collector_xray" {
  depends_on = [aws_eks_addon.adot]
  chart      = "./helmcharts/adotxray"
  name       = "${local.name_prefix}-adot-xray-collector-${local.name_suffix}"
  namespace = kubernetes_namespace.adot.metadata.0.name
}
