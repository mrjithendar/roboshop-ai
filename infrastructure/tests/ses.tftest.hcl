mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
}

variables {
  environment        = "test"
  availability_zones = ["us-east-1a", "us-east-1b"]
}

run "ses_disabled_by_default" {
  command = plan
  assert {
    condition     = length(aws_sesv2_email_identity.store) == 0 && length(aws_iam_user.ses_smtp) == 0
    error_message = "SES must be opt-in for environments that do not configure it."
  }
}

run "ses_transactional_domain" {
  command = plan
  variables {
    ses_enabled = true
    ses_domain  = "jithendar.com"
  }
  assert {
    condition     = aws_sesv2_email_identity.store[0].email_identity == "jithendar.com" && aws_sesv2_email_identity.store[0].dkim_signing_attributes[0].next_signing_key_length == "RSA_2048_BIT"
    error_message = "Verify the sender domain using 2048-bit Easy DKIM."
  }
  assert {
    condition     = aws_sesv2_email_identity_mail_from_attributes.store[0].mail_from_domain == "bounce.jithendar.com" && aws_sesv2_email_identity_mail_from_attributes.store[0].behavior_on_mx_failure == "REJECT_MESSAGE"
    error_message = "Use a dedicated MAIL FROM domain and reject unverified MAIL FROM DNS."
  }
  assert {
    condition     = output.ses_smtp.host == "email-smtp.us-east-1.amazonaws.com" && output.ses_smtp.port == 587 && output.ses_smtp.from == "no-reply@jithendar.com"
    error_message = "SMTP settings must use regional SES with STARTTLS on 587."
  }
}

run "reject_invalid_domain" {
  command = plan
  variables {
    ses_domain = "https://jithendar.com"
  }
  expect_failures = [var.ses_domain]
}
