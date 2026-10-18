# Generate Random String
resource "random_string" "suffix" {
  length  = 5
  special = false
}