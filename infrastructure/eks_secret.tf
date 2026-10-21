# create aecret with dummy-data
# kubectl create secret generic eab-secret -n cert-manager --from-literal secret=123-001

resource "kubernetes_secret" "eab_secret" {
  metadata {
    name      = "eab-secret"
    namespace = "cert-manager"
  }
  data = {
    # dummy secret
    secret = "123-001"
  }
  type = "Opaque"
}