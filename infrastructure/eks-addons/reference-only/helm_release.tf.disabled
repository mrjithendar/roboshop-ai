# resource "helm_release" "k8s_dashboard" {
#   name = "my-kubernetes-dashboard"
#   repository = "https://kubernetes.github.io/dashboard/"
#   chart      = "kubernetes-dashboard"
#   namespace  = "default"
#   set {
#     name  = "service.type"
#     value = "LoadBalancer"
#   }
#   set {
#     name  = "protocolHttp"
#     value = "true"
#   }
#   set {
#     name  = "service.externalPort"
#     value = 80
#   }
#   set {
#     name  = "replicaCount"
#     value = 2
#   }
#   set {
#     name  = "rbac.clusterReadOnlyRole"
#     value = "true"
#   }
# }