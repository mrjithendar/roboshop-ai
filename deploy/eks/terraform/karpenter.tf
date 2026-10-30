# Karpenter controller IAM (Pod Identity), node IAM role + access entry, and the SQS queue with
# EventBridge rules for Spot interruption, rebalance, scheduled-change and instance-state events.
# The controller itself is installed with Helm (../platform/install.sh) onto the system node group.
module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "21.29.0"

  cluster_name = module.eks.cluster_name

  namespace                       = "kube-system"
  service_account                 = "karpenter"
  create_pod_identity_association = true

  enable_spot_termination = true

  node_iam_role_use_name_prefix = false
  node_iam_role_name            = "${var.name}-karpenter-node"
  node_iam_role_additional_policies = {
    # Session Manager access for break-glass debugging instead of SSH keys.
    ssm = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
  }
}
