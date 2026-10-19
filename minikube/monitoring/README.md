# Monitoring namespace

Grafana and Prometheus install in **`monitoring`**. WordPress remains in `jithendar-com` and RobotShop remains in `robotshop-ai`.

```bash
bash minikube/deploy-prometheus.sh
bash minikube/deploy-grafana.sh
```

Both scripts create the namespace and apply `certificate.yaml`. This namespace-local Certificate produces `jithendar-com-tls` for both monitoring ingresses. It does not modify WordPress's certificate. cert-manager and its ClusterIssuer remain shared cluster infrastructure.

## Certificate ownership

There is **one shared certificate for monitoring**, not one per application. `prometheus` is the Helm release/Service name; it is not a namespace created by these installers.

| Namespace | Certificate | Generated TLS Secret | Used by | Definition |
| --- | --- | --- | --- | --- |
| `monitoring` | `jithendar-com` | `jithendar-com-tls` | Grafana and Prometheus | `minikube/monitoring/certificate.yaml` |
| `jithendar-com` | `jithendar-com` | `jithendar-com-tls` | WordPress | `minikube/wordpress/templates/certificate.yaml` |

The identical names in two namespaces refer to separate objects. Ingress TLS Secrets must be in the ingress's namespace. Both certificates cover the hostname `jithendar.com`; URL paths such as `/grafana` and `/prometheus` do not need separate certificates.

Each monitoring installer applies the same manifest so either can run first. `kubectl apply` updates that existing namespace/name; a second invocation does not create a second certificate. cert-manager manages issuance and renewal. Neither the Prometheus chart nor Grafana values declares a Certificate or enables ingress-shim issuance; their ingresses only reference the shared Secret.

The `cert-manager` namespace contains the certificate controller. The `letsencrypt-prod` ClusterIssuer is cluster-wide, not a certificate and not tied to one application. `minikube/cert-manager/certificate.example.yaml` is an optional **legacy example** targeting `robotshop-ai`; neither monitoring installer uses it. Do not apply that example for monitoring.

### Check the live cluster

```bash
# List actual certificate objects across all namespaces:
kubectl get certificates -A
# Expected monitoring object: jithendar-com, Ready=True
kubectl -n monitoring get certificate jithendar-com
# Both monitoring ingresses should show the SAME Secret name:
kubectl -n monitoring get ingress grafana prometheus \
  -o custom-columns='NAME:.metadata.name,TLS-SECRET:.spec.tls[*].secretName'
# Inspect issuance/renewal without displaying private key material:
kubectl -n monitoring describe certificate jithendar-com
```

`CertificateRequest`, `Order`, and `Challenge` objects are issuance records, not additional application Certificates. If you see an old certificate in `robotshop-ai` or `prometheus`, it is outside the current monitoring installers. Inspect its ingress references and ownership before removing anything; these scripts do not delete old TLS resources automatically.

- Grafana: **https://jithendar.com/grafana/**
- Prometheus: **https://jithendar.com/prometheus/**
- Grafana's internal data source: `http://prometheus.monitoring.svc.cluster.local:9090/prometheus`

Use the intended context (`--context=YOUR_CONTEXT`) when needed:

```bash
kubectl -n monitoring get pods,pvc,svc,ingress,certificate
# Shared Grafana/Prometheus password, username admin:
kubectl -n monitoring get secret monitoring-auth -o jsonpath='{.data.password}' | base64 --decode; echo
# Prometheus password, username admin:
kubectl -n monitoring get secret monitoring-auth -o jsonpath='{.data.password}' | base64 --decode; echo
```

## Existing installations in robotshop-ai

Changing a Helm namespace creates a separate release; it does not move dashboards, users, metrics history, Secrets or PVCs. The installers stop before mutation if the corresponding old Deployment, Ingress or PVC exists in `robotshop-ai`. This prevents an accidental empty replacement and duplicate routes on the same domain.

For a site already running, use a planned migration: back up Grafana's data and credentials and Prometheus's data and authentication Secret; restore them to new PVCs/Secrets in `monitoring`; validate the new instances privately; then cut over the ingress routes. Stop writes while taking consistent volume backups. Keep the backups and original data until the new instances are verified. The current scripts handle fresh installs and upgrades within `monitoring`, not this cross-namespace migration.

Do not delete `robotshop-ai`: it may contain RobotShop and other workloads. Do not remove old PVCs just to bypass the check. If historical monitoring data is disposable, explicitly decide to reset those releases instead of migrating them; this is a separate destructive operation.

For component configuration and troubleshooting, see [Grafana](../grafana/README.md) and [Prometheus](../prometheus/README.md).

## Shared login Secret

Both applications use **`monitoring/monitoring-auth`**, type `kubernetes.io/basic-auth`, with keys `username` and `password`. Username is `admin`. This is separate from the shared **TLS** Secret `jithendar-com-tls`.

```bash
bash minikube/deploy-grafana.sh
bash minikube/deploy-prometheus.sh
kubectl -n monitoring get secret monitoring-auth -o jsonpath='{.data.password}' | base64 --decode; echo
```

`credentials.py` is called by both installers. It reuses an existing shared Secret without rotating it. On first migration it copies the stored Grafana credentials if available, otherwise the old Prometheus credentials; a fresh installation generates a strong random password. Run both installers to finish the migration. Prometheus's previous password changes if a different Grafana password was adopted.

Grafana's chart references this existing Secret using `username`/`password`. Because Grafana also stores credentials in its database, its installer explicitly synchronizes the original administrator (user ID 1) via the Grafana CLI, passing the password through stdin rather than command arguments. If you renamed/deleted that account, reconcile the administrator before using this automatic synchronization. A password changed only in Grafana's UI will be replaced on the next installer run.

Prometheus's Traefik Middleware references `monitoring-auth` directly. The `prometheus-auth` **Middleware name** stays unchanged; only its Secret reference changes. Grafana and Prometheus keep separate login sessions; this is shared credentials, not single sign-on.

Old standalone Secrets are not manually deleted by the helper. Grafana's old Helm-managed Secret may be removed by the Helm upgrade after its credentials have been copied; its PVC is preserved. The old standalone Prometheus Secret may remain unused. Both applications must be upgraded before considering cleanup. Do not delete `monitoring-auth` to rotate it: update it deliberately and rerun Grafana's installer to synchronize the database.
