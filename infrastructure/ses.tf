# DNS is managed outside this stack. Publish ses_dns_records after applying.
resource "aws_sesv2_email_identity" "store" {
  count          = var.ses_enabled ? 1 : 0
  email_identity = var.ses_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = local.common_tags
}

resource "aws_sesv2_email_identity_mail_from_attributes" "store" {
  count                  = var.ses_enabled ? 1 : 0
  email_identity         = aws_sesv2_email_identity.store[0].email_identity
  mail_from_domain       = "bounce.${var.ses_domain}"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}

# Create the SMTP identity, but never store long-lived access keys in Terraform state.
resource "aws_iam_user" "ses_smtp" {
  count = var.ses_enabled ? 1 : 0
  name  = "roboshop-${var.environment}-ses-smtp"
  tags  = local.common_tags
}

resource "aws_iam_user_policy" "ses_smtp" {
  count = var.ses_enabled ? 1 : 0
  name  = "send-store-email"
  user  = aws_iam_user.ses_smtp[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ses:SendRawEmail"
      Resource = aws_sesv2_email_identity.store[0].arn
      Condition = {
        StringEquals = { "ses:FromAddress" = "no-reply@${var.ses_domain}" }
      }
    }]
  })
}

output "ses_dns_records" {
  description = "Publish these DNS records (DKIM CNAMEs must be DNS-only, not proxied). MAIL FROM MX priority is included in value."
  value = var.ses_enabled ? concat(
    [for token in aws_sesv2_email_identity.store[0].dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      name  = "${token}._domainkey.${var.ses_domain}"
      value = "${token}.dkim.amazonses.com"
    }],
    [
      { type = "MX", name = "bounce.${var.ses_domain}", value = "10 feedback-smtp.${var.aws_region}.amazonses.com" },
      { type = "TXT", name = "bounce.${var.ses_domain}", value = "v=spf1 include:amazonses.com ~all" }
    ]
  ) : []
}

output "ses_smtp" {
  description = "SMTP connection settings. The IAM user name is not the SMTP login; create region-specific SMTP credentials separately."
  value = var.ses_enabled ? {
    host         = "email-smtp.${var.aws_region}.amazonaws.com"
    port         = 587
    security     = "starttls"
    from         = "no-reply@${var.ses_domain}"
    iam_user     = aws_iam_user.ses_smtp[0].name
    identity_arn = aws_sesv2_email_identity.store[0].arn
  } : null
}
