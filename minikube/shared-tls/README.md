# One jithendar.com certificate

Run after the updated files are on your machine:

```bash
KUBE_CONTEXT=mk4 bash minikube/setup-shared-tls.sh
```

The ready Certificate `jithendar/jithendar-com` (created by the WordPress chart)
remains the sole issuer-managed certificate for this hostname. Its Secret is
`jithendar/jithendar-com-tls`. A Traefik `TLSStore` named `default` in that namespace
uses the Secret as its default certificate. Traefik watches certificate renewals;
no CronJob, copied private keys, or Secret synchronization controller is needed.

The script checks the ready source and refuses conflicting default TLSStores,
then removes only the known jithendar.com TLS Secret references from Traefik
Ingresses in argocd, monitoring and roboshop-ai. It preserves hosts, routes and
HTTPS settings. Finally it deletes only the matching duplicate Certificate
objects with orphan propagation; existing Secrets are not deleted. Reruns are
safe. No new ACME request is made by this script. Run it before deploying the
updated consumers; their installers also call it automatically.

This is one certificate for **jithendar.com**, not every domain. JFrog's separate
hostname still needs its own certificate. Traefik must watch namespace jithendar,
and there can be only one `default` TLSStore across its watched namespaces. Other
ingress controllers do not use this store. The default also applies to unmatched
TLS SNI; clients still validate the hostname against the certificate.

On a fresh cluster install WordPress first and wait for its certificate. Do not
uninstall the canonical WordPress certificate or delete namespace jithendar while
other apps use it. Back up its Certificate and Secret securely. Existing unused
namespace-local TLS Secrets may be kept for rollback, but will not renew.

Verify:

```bash
kubectl --context=mk4 -n jithendar get certificate jithendar-com
kubectl --context=mk4 -n jithendar get tlsstore default
kubectl --context=mk4 get certificates -A
curl -I https://jithendar.com/argocd/
```

For rollback, restore the previous ingress Secret references only while those
certificates are still valid. Restore separate Certificate resources only if you
intend to resume separate issuance and have considered ACME rate limits. Helm
releases retain old stored manifests until their next upgrade; run the updated
Grafana/Prometheus installers so subsequent Helm rollbacks don't reintroduce
obsolete Secret references. Never restore the old duplicate issuance manifests
as part of an ordinary deployment.

References: https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/crd/tls/tlsstore/
