## https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.4.7/docs/install/iam_policy.json
#resource "aws_iam_role" "eks_loadbalancer" {
#  name = "${local.name_prefix}-eks-lbc-role-${local.name_suffix}"
#  assume_role_policy = jsonencode({
#    Version = "2012-10-17"
#    Statement = [
#      {
#        Action = "sts:AssumeRoleWithWebIdentity"
#        Effect = "Allow"
#        Principal = {
#          Federated = "${local.cluster_oidc_arn}"
#        }
#        Condition = {
#          StringEquals = {
#            "${local.cluster_oidc_arn}:aud" : "sts.amazonaws.com",
#            "${local.cluster_oidc_arn}:sub" : "system:serviceaccount:kube-system:aws-load-balancer-controller"
#          }
#        }
#      },
#    ]
#  })
#  tags = (merge(local.our_tags, tomap({
#    "Name"    = "${local.name_prefix}-eks-lbc-role-${var.environment}",
#    "Purpose" = "${local.our_tags["Team"]} eks loadbalancer controller role"
#  })))
#}
#
#resource "aws_iam_policy" "eks_lb_iam_policy" {
#  name        = "${local.name_prefix}-eks-lbc-iam-policy-${local.name_suffix}"
#  path        = "/"
#  description = "eks loadbalancer iam policy"
#  policy      = data.http.eks_lbc_policy.response_body
#  tags = (merge(local.our_tags, tomap({
#    "Name"    = "${local.name_prefix}-eks-lbc-role-policy-${var.environment}",
#    "Purpose" = "${local.our_tags["Team"]} eks loadbalancer controller role policy"
#  })))
#}
#
#resource "aws_iam_role_policy_attachment" "eks_loadbalancer" {
#  role       = aws_iam_role.eks_loadbalancer.name
#  policy_arn = aws_iam_policy.eks_lb_iam_policy.arn
#}
#
## Resource: Helm Release Loadbalancer
#resource "helm_release" "loadbalancer_controller" {
#  name            = "${local.name_prefix}-eks-lbc-${local.name_suffix}"
#  repository      = "https://aws.github.io/eks-charts"
#  chart           = "aws-load-balancer-controller"
#  namespace       = "default"
#  cleanup_on_fail = true
#  set {
#    name  = "image.repository"
#    value = "602401143452.dkr.ecr.us-east-1.amazonaws.com/amazon/aws-load-balancer-controller" # Changes based on Region - This is for us-east-1 Additional Reference: https://docs.aws.amazon.com/eks/latest/userguide/add-ons-images.html
#  }
#  set {
#    name  = "serviceAccount.create"
#    value = "true"
#  }
#  set {
#    name  = "serviceAccount.name"
#    value = "aws-load-balancer-controller"
#  }
#  set {
#    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
#    value = aws_iam_role.eks_loadbalancer.arn
#  }
#  set {
#    name  = "vpcId"
#    value = data.terraform_remote_state.jith.outputs.vpc_id
#  }
#  set {
#    name  = "region"
#    value = data.aws_region.current.name
#  }
#  set {
#    name  = "clusterName"
#    value = data.terraform_remote_state.jith.outputs.cluster_name
#  }
#}
#
## Resource: Kubernetes Ingress Class
#resource "kubernetes_ingress_class_v1" "ingress_class_default" {
#  depends_on = [helm_release.loadbalancer_controller]
#  metadata {
#    name = "my-aws-ingress-class"
#    annotations = {
#      "ingressclass.kubernetes.io/is-default-class" = "true"
#    }
#  }
#  spec {
#    controller = "ingress.k8s.aws/alb"
#  }
#}