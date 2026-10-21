mock_provider "aws" {
  mock_data "aws_eks_cluster" {
    defaults = {
      endpoint              = "https://example.invalid"
      version               = "1.36"
      certificate_authority = [{ data = "dGVzdA==" }]
      vpc_config            = [{ vpc_id = "vpc-12345678" }]
    }
  }
  mock_data "aws_eks_addon_version" {
    defaults = { version = "v1.0.0-eksbuild.1" }
  }
}
mock_provider "helm" {}
mock_provider "kubernetes" {}
run "restricted_workload_identities" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_role.lbc.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-service-account"] == "aws-load-balancer-controller" && jsondecode(aws_iam_role.lbc.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/eks-cluster-name"] == var.cluster_name
    error_message = "LBC trust must bind the specific service account and cluster."
  }
  assert {
    condition     = jsondecode(aws_iam_role.ebs.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-service-account"] == "ebs-csi-controller-sa" && jsondecode(aws_iam_role.ebs.assume_role_policy).Statement[0].Condition.StringEquals["aws:RequestTag/kubernetes-namespace"] == "kube-system"
    error_message = "EBS trust must bind the storage controller service account."
  }
  assert {
    condition     = kubernetes_storage_class_v1.gp3.reclaim_policy == "Retain" && kubernetes_storage_class_v1.gp3.volume_binding_mode == "WaitForFirstConsumer" && kubernetes_storage_class_v1.gp3.parameters.encrypted == "true"
    error_message = "EBS storage must retain data, bind with topology and use encryption."
  }
}
