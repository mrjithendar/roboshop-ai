resource "aws_iam_role" "ebs" {
  name = "${var.cluster_name}-ebs-csi"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["sts:AssumeRole", "sts:TagSession"], Principal = { Service = "pods.eks.amazonaws.com" }, Condition = { StringEquals = {
    "aws:RequestTag/eks-cluster-name"           = var.cluster_name
    "aws:RequestTag/kubernetes-namespace"       = "kube-system"
    "aws:RequestTag/kubernetes-service-account" = "ebs-csi-controller-sa"
  } } }] })
}
resource "aws_iam_role_policy_attachment" "ebs" {
  role       = aws_iam_role.ebs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
resource "aws_eks_pod_identity_association" "ebs" {
  cluster_name    = var.cluster_name
  namespace       = "kube-system"
  service_account = "ebs-csi-controller-sa"
  role_arn        = aws_iam_role.ebs.arn
}
data "aws_eks_addon_version" "ebs" {
  addon_name         = "aws-ebs-csi-driver"
  kubernetes_version = data.aws_eks_cluster.main.version
  most_recent        = false
}
resource "aws_eks_addon" "ebs" {
  cluster_name                = var.cluster_name
  addon_name                  = "aws-ebs-csi-driver"
  addon_version               = data.aws_eks_addon_version.ebs.version
  resolve_conflicts_on_update = "PRESERVE"
  depends_on                  = [aws_iam_role_policy_attachment.ebs, aws_eks_pod_identity_association.ebs]
}
resource "kubernetes_storage_class_v1" "gp3" {
  metadata { name = "gp3" }
  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Retain"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  depends_on             = [aws_eks_addon.ebs]
  parameters             = { type = "gp3", encrypted = "true" }
}
