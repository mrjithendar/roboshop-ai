resource "helm_release" "cmpermissions" {
  namespace        = "cert-manager"
  create_namespace = true
  chart            = "./helmcharts/permissions"
  name             = "${local.name_prefix}-permissions-${local.name_suffix}"
}

resource "helm_release" "cert_manager" {
  depends_on       = [helm_release.cmpermissions]
  chart            = "cert-manager"
  name             = "${local.name_prefix}-cert-manager-${local.name_suffix}"
  namespace        = "cert-manager"
  version          = "1.12.0"
  create_namespace = true
  repository       = "https://charts.jetstack.io"
  set {
    name  = "global.leaderElection.namespace"
    value = "cert-manager"
  }
  set {
    name  = "installCRDs"
    value = "true"
  }
  set {
    name  = "webhook.securePort"
    value = "10260"
  }
  set {
    name  = "webhook.hostNetwork"
    value = "true"
  }
  set {
    name  = "prometheus.enabled"
    value = "false"
  }
  set {
    name  = "webhook.timeoutSeconds"
    value = "4"
  }
}