resource "aws_iam_role" "lbc" {
  name = "${var.cluster_name}-load-balancer-controller"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["sts:AssumeRole", "sts:TagSession"], Principal = { Service = "pods.eks.amazonaws.com" }, Condition = { StringEquals = {
    "aws:RequestTag/eks-cluster-name"           = var.cluster_name
    "aws:RequestTag/kubernetes-namespace"       = "kube-system"
    "aws:RequestTag/kubernetes-service-account" = "aws-load-balancer-controller"
  } } }] })
}
# Official policy pinned to the controller version; review alongside chart upgrades.
resource "aws_iam_role_policy" "lbc" {
  role   = aws_iam_role.lbc.id
  policy = file("${path.module}/lbc-iam-policy.json")
}
resource "aws_eks_pod_identity_association" "lbc" {
  cluster_name    = var.cluster_name
  namespace       = "kube-system"
  service_account = "aws-load-balancer-controller"
  role_arn        = aws_iam_role.lbc.arn
}
resource "helm_release" "lbc" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "3.6.0"
  values = [yamlencode({
    clusterName    = var.cluster_name
    region         = var.aws_region
    vpcId          = data.aws_eks_cluster.main.vpc_config[0].vpc_id
    serviceAccount = { create = true, name = "aws-load-balancer-controller" }
  })]
  depends_on = [aws_iam_role_policy.lbc, aws_eks_pod_identity_association.lbc]
}
resource "helm_release" "traefik" {
  name             = "traefik"
  namespace        = "traefik"
  create_namespace = true
  repository       = "https://traefik.github.io/charts"
  chart            = "traefik"
  version          = "42.1.0"
  values = [yamlencode({
    deployment   = { replicas = 2 }
    ingressClass = { enabled = true, name = "traefik", isDefaultClass = false }
    providers    = { kubernetesIngress = { enabled = true }, kubernetesCRD = { enabled = true } }
    service = {
      type = "LoadBalancer"
      annotations = {
        "service.beta.kubernetes.io/aws-load-balancer-type"            = "external"
        "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type" = "ip"
        "service.beta.kubernetes.io/aws-load-balancer-scheme"          = "internet-facing"
      }
    }
  })]
  depends_on = [helm_release.lbc]
}
