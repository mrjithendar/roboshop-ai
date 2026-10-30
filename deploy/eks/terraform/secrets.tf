# Secret containers only. Terraform never sees or stores the values: put them with
# ../scripts/put-secrets.sh, which generates random values locally and never prints them.
# External Secrets syncs them into the Kubernetes Secret `roboshop-secrets` (../k8s/secrets).
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.secrets_prefix}/${var.environment}/app"
  description             = "RoboShop AI application credentials (${var.name})"
  recovery_window_in_days = var.environment == "demo" ? 0 : 7
}
