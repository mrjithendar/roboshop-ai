resource "helm_release" "nginx_ingress" {
  name       = "${local.name_prefix}-nginx-ingress-controller-${local.name_suffix}"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "nginx-ingress-controller"
  namespace  = "nginxingress"
  set {
    name  = "service.type"
    value = "LoadBalancer"
  }
}

resource "kubernetes_pod_v1" "app1" {
  depends_on = [kubernetes_ingress_v1.ingress]
  metadata {
    name = "my-app1"
    namespace = "nginxingress"
    labels = {
      "app" = "app1"
    }
  }
  spec {
    container {
      image = "hashicorp/http-echo"
      name  = "my-app1"
      args  = ["-text=Hello from my app 1"]
    }
  }
}

resource "kubernetes_pod_v1" "app2" {
  depends_on = [kubernetes_ingress_v1.ingress]
  metadata {
    namespace = "nginxingress"
    name = "my-app2"
    labels = {
      "app" = "app2"
    }
  }
  spec {
    container {
      image = "hashicorp/http-echo"
      name  = "my-app2"
      args  = ["-text=Hello from my app 2"]
    }
  }
}

resource "kubernetes_service_v1" "app1_service" {
  depends_on = [kubernetes_pod_v1.app1]
  metadata {
    namespace = "nginxingress"
    name = "my-app1-service"
  }
  spec {
    selector = {
      app = kubernetes_pod_v1.app1.metadata.0.labels.app
    }
    port {
      port = 5678
    }
  }
}

resource "kubernetes_service_v1" "app2_service" {
  depends_on = [kubernetes_pod_v1.app2]
  metadata {
    namespace = "nginxingress"
    name = "my-app2-service"
  }
  spec {
    selector = {
      app = kubernetes_pod_v1.app2.metadata.0.labels.app
    }
    port {
      port = 5678
    }
  }
}

resource "kubernetes_ingress_v1" "ingress" {
  depends_on = [helm_release.nginx_ingress]
  wait_for_load_balancer = true
  metadata {
    namespace = "nginxingress"
    name = "${local.name_prefix}-nginx-ingress-${local.name_suffix}"
  }
  spec {
    ingress_class_name = "nginx"
    rule {
      http {
        path {
          backend {
            service {
              name = "my-app1-service"
              port {
                number = 5678
              }
            }
          }
          path = "/app1"
        }
        path {
          backend {
            service {
              name = "my-app2-service"
              port {
                number = 5678
              }
            }
          }
          path = "/app2"
        }
      }
    }
  }
}