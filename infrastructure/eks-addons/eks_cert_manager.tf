# Official chart owns the matching CRDs and RBAC; do not apply vendored old CRDs.
resource "helm_release" "cert_manager" {
  chart            = "cert-manager"
  name             = "cert-manager"
  namespace        = "cert-manager"
  version          = "v1.21.2"
  create_namespace = true
  repository       = "https://charts.jetstack.io"
  values = [yamlencode({
    crds   = { enabled = true }
    global = { leaderElection = { namespace = "cert-manager" } }
  })]
}
