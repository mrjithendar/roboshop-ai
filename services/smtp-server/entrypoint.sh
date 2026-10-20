#!/bin/sh
set -eu
# Secret mounts are read-only. Copy the signing key to a private runtime path.
install -d -m 0750 -o opendkim -g opendkim /etc/mail-dkim
install -m 0600 -o opendkim -g opendkim /run/mail-dkim/robotshop.private /etc/mail-dkim/robotshop.private
# Only authenticated mTLS connections can reach the signing milter.
printf '0.0.0.0/0\n' > /etc/opendkim-internal-hosts
printf '/^no-reply@jithendar[.]com$/ OK\n' > /etc/postfix/allowed-senders
# Disable public SMTP and chroot (TLS/CA/milter paths are container paths).
postconf -MX smtp/inet
postconf -M 'submission/inet=submission inet n - n - - smtpd'
postconf -M | awk 'NF >= 8 && $1 !~ /^-/ {print $1 "/" $2 "/chroot=n"}' | while read -r field; do
  postconf -F "$field"
done
newaliases
postfix check
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/mail.conf
