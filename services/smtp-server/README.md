# RobotShop SMTP and account recovery

Postfix sends RobotShop password-reset codes directly to recipient mail servers.
OpenDKIM signs mail as `jithendar.com`, using selector `robotshop`.
The sender is `no-reply@jithendar.com`; this is an outbound service, not a mailbox server.

The SMTP service is internal (`ClusterIP`, port 587). There is no public SMTP port,
Ingress, or open relay. The user service uses STARTTLS with a client certificate signed
by a dedicated private CA. cert-manager manages both certificates. A NetworkPolicy
also limits access to user-service when the cluster CNI supports policy enforcement.
Certificate authentication remains required even without NetworkPolicy support.

## Before deployment

1. Ask Vultr to allow **outbound TCP port 25** on the host. A private SMTP server
   cannot deliver directly to external MX servers while this is blocked.
2. Add a DNS-only A record `mail.jithendar.com` pointing to your Vultr public IP.
   Do not enable Cloudflare's HTTP proxy on this record.
3. Set the IP's reverse DNS/PTR in Vultr to `mail.jithendar.com`. Forward and reverse
   records must agree. The SMTP HELO name is also `mail.jithendar.com`.
4. Add or update the **single existing SPF record** at `jithendar.com` to authorize
   the host IP, e.g. `v=spf1 ip4:YOUR_VULTR_IP ~all`. Merge existing authorized
   senders; never create a second SPF record or remove another mail provider.
5. Add the DKIM TXT record printed by the installer below. The public key is safe
   to publish. Keep the private Kubernetes Secret private and backed up.
6. If there is no DMARC record, start with TXT `_dmarc.jithendar.com`:
   `v=DMARC1; p=none`. Preserve any existing domain policy. Monitor delivery before
   tightening the policy. Sending from this service does not require changing MX
   records or moving your existing inboxes.

Without these steps, a running pod does **not** mean password-reset delivery works.
Vultr documents its default port block at
https://docs.vultr.com/support/products/compute/why-is-smtp-blocked.

## Build and install on the Vultr Minikube host

Run from the repository root, after syncing these changes. cert-manager and the
`robotshop-ai` namespace must already exist. The installer uses your current
kubectl context; set `KUBE_CONTEXT` and `PROFILE` if their names differ.

```bash
bash minikube/deploy-smtp.sh --check
bash build-images.sh --service smtp-server --local
bash minikube/deploy-smtp.sh

bash build-images.sh --service user-service --local
bash deploy-minikube.sh --service user-service --load-images
bash build-images.sh --service ai-gateway --local
bash deploy-minikube.sh --service ai-gateway --load-images
bash build-images.sh --service frontend --local
bash deploy-minikube.sh --service frontend --load-images
```

The **Deploy-Minikube** GitHub Actions workflow now builds and deploys
`smtp-server` immediately after infrastructure dependencies, before `user-service` and `ai-gateway`.
Its preflight checks include OpenSSL. The SMTP step prints the public DKIM record;
repeat runs preserve the existing signing and authenticator encryption keys.

For a quick update of an existing cluster, run just the SMTP, user service, gateway and frontend
commands above; rebuilding the other application images is unnecessary.

SMTP has its own installer because its CA, DKIM key and encryption key must exist
before account recovery is enabled. `build-images.sh --local` includes its image;
`deploy-minikube.sh` keeps its existing app deployment scope. Use `deploy-smtp.sh`
for SMTP deployment and image refresh. No Compose files are required.

The installer preserves existing keys across reruns:

- `smtp-dkim`: private DKIM signing key.
- `smtp-ca`, `smtp-server-tls`, `smtp-client-tls`: cert-manager TLS secrets.
- `robotshop-auth`: SMTP connection settings and `AUTH_ENCRYPTION_KEY`.

**Back up `AUTH_ENCRYPTION_KEY` with MongoDB.** It encrypts authenticator seeds.
Replacing it breaks enrolled authenticators. Never regenerate it during rebuilds.
The installer configures internal SMTP and preserves the existing encryption key.
Private credentials are never printed or stored in the repository.

## Password reset and authenticator flow

On `/roboshop/login`, select **Forgot password?**, enter your account email, and
complete Cloudflare verification. The email contains a six-digit code valid for
five minutes. Enter the code and a new 12–128 character password on the same page.

Codes are one-use, limited to five verification attempts, and stored as keyed
hashes. Sending a replacement invalidates the previous code. Requests are limited
per IP and per email. Responses do not disclose whether an account exists.
Resetting a password revokes existing login sessions and pending challenges.
**It does not disable an enrolled authenticator.**

In **Account → Account security → Manage authenticator**, confirm your password,
scan the QR code using Microsoft Authenticator (or another TOTP app), and enter
its six-digit code. Save the ten one-use backup codes immediately. Enabling or
disabling MFA signs out existing sessions. A lost authenticator can be replaced
by signing in with a backup code, disabling it with another backup code, then
setting up the replacement. Backup codes do not reset a forgotten password.

Microsoft does not manage these RobotShop passwords; no Microsoft account is
required. Already signed-in users are redirected away from the login page.

## Verify delivery

Use a registered account you control, request a reset through the login page,
and verify receipt and the five-minute expiry. Do not send tests to other users.

```bash
kubectl -n robotshop-ai get pods -l app=smtp-server
kubectl -n robotshop-ai get certificates smtp-ca smtp-server-tls smtp-client-tls
kubectl -n robotshop-ai logs deployment/smtp-server --tail=100
kubectl -n robotshop-ai exec deployment/smtp-server -- postqueue -p
kubectl -n robotshop-ai logs deployment/user-service --tail=100
```

Check received-message headers for SPF, DKIM and DMARC results. SMTP acceptance
is not proof of inbox delivery. OTP messages are queued for at most five minutes;
expired codes are always rejected by the application, even if mail arrives late.
Postfix logs include recipient addresses for delivery diagnostics: restrict log
access and retention. The application does not log passwords, OTPs or MFA seeds.

## Troubleshooting

- **Connection timed out / deferred**: check Vultr's outbound port-25 block, host
  firewall and DNS resolution. Open port 25 outbound; do not expose SMTP inbound.
- **Spam/rejected**: verify A/PTR, SPF and the `robotshop._domainkey` record; inspect
  the recipient server's rejection. Inbox placement also depends on IP reputation.
- **TLS or client-certificate error**: check all three certificates are Ready and
  `smtp-client-tls` is mounted at `/etc/robotshop-smtp` in user-service. Do not disable
  certificate verification. User service loads current certificates for each send;
  Postfix reads renewed files in newly spawned SMTP workers. Restart SMTP after
  manual CA changes. CA rotation requires a coordinated reissue of both leaf certs.
- **Recovery not configured**: deploy the updated user-service manifest and image after
  running the SMTP installer; check that `robotshop-auth` exists. Old user-service pods
  do not pick up Secret environment changes until restarted.
- **No message but generic success**: inspect user-service/SMTP logs. Delivery failures
  deliberately do not expose account existence or SMTP credentials to the caller.
- **Code rejected**: use the newest code, within five minutes and five attempts.
  Request a new code if you closed the page; its reset identifier lives only in
  that page's memory. Check host clock synchronization for authenticator codes.
- **Authenticator recovery**: use saved backup codes. Email reset never removes
  MFA. If both the authenticator and backup codes are lost, support must verify
  account ownership through an administrative recovery procedure.

Implementation references:
[Postfix client-certificate relay authorization](https://www.postfix.org/TLS_README.html),
[Gmail sender requirements](https://support.google.com/mail/answer/81126),
[Fernet authenticated encryption](https://cryptography.io/en/stable/fernet/).
