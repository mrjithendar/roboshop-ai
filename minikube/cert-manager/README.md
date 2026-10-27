> Deployment-script cleanup: imperative application deployment commands in this
> document are retired. Use the Argo CD catalog and the five supported commands
> documented in `docs/operations/scripts.md`. Historical examples below are not
> runnable deployment instructions.

# cert-manager with Let's Encrypt

Run from the repository root on your Minikube host:

```bash
bash minikube/deploy-cert-manager.sh
```

The script requires a running Minikube cluster, `kubectl`, and Helm. If Helm is missing, install it using the [official Helm installation instructions](https://helm.sh/docs/intro/install/). It installs the pinned official cert-manager chart (`v1.20.4`) with CRDs, waits for readiness, and installs a small local Helm chart containing two ClusterIssuers:

| Issuer | Purpose |
| --- | --- |
| `letsencrypt-staging` | Test issuance; browsers do not trust its certificates. |
| `letsencrypt-prod` | Trusted website certificates and automatic renewal. |

It follows the installer's selected `mk4` profile. Use `PROFILE=another-base-profile` if needed. From a laptop with a remote kubeconfig, explicitly set `KUBE_CONTEXT` to the context in that file. Every command targets that context; the script does not silently use an unrelated current cluster.

## Configuration

- `values.yaml`: official cert-manager Helm values and resources.
- `issuers/values.yaml`: ACME email, ingress class, endpoints and account Secret names.
- `issuers/templates/letsencrypt-staging-cluster-issuer.yaml` and `letsencrypt-production-cluster-issuer.yaml`: one issuer per template.
- `certificate.example.yaml`: optional certificate request for `jithendar.com`.

The default account email is `jithendardharmapuri@gmail.com` and the ingress class is `traefik`. Override without editing YAML:

```bash
LETSENCRYPT_EMAIL=jithendardharmapuri@gmail.com INGRESS_CLASS=traefik \
  bash minikube/deploy-cert-manager.sh
```

Use the actual installed class from `kubectl get ingressclass`. The script installs cert-manager, **not an ingress controller or the RoboShop app**. It reports a missing ingress class but can still register the ACME accounts. Reruns use Helm upgrades and preserve existing account keys. If an issuer or cert-manager installation already belongs to another Helm release, reconcile ownership deliberately rather than deleting it.

## Which certificate file to use

- **Grafana + Prometheus:** no Certificate of their own; Traefik serves the shared `jithendar/jithendar-com` certificate through the default TLSStore.
- **WordPress:** its Helm chart creates its Certificate in `jithendar-com`.
- **Legacy/manual RoboShop setup only:** `certificate.example.yaml` targets `roboshop-ai`. Do not apply it for the monitoring setup.

See [certificate ownership](../monitoring/README.md#certificate-ownership) for the resource names and live verification commands.

## Optional legacy RoboShop certificate example

Before requesting a certificate, make `jithendar.com` resolve directly to your Vultr server and ensure public TCP port **80** reaches your ingress controller for HTTP-01 validation. Port **443** is needed for the website. Minikube's private NodePort alone is not public access; keep the site's host routing/load balancer in place. These requirements also apply to renewal.

After the site namespace and ingress controller exist:

```bash
kubectl apply -f minikube/cert-manager/certificate.example.yaml
kubectl -n roboshop-ai wait --for=condition=Ready certificate/jithendar-com --timeout=10m
```

Configure the site's Ingress with the same class and TLS Secret:

```yaml
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - jithendar.com
      secretName: jithendar-com-tls
```

This snippet belongs in the app's existing Ingress; it is not a complete standalone manifest. Keep the Certificate and Ingress in the same namespace. Alternatively, use the `cert-manager.io/cluster-issuer: letsencrypt-prod` ingress annotation with `spec.tls` instead of managing an explicit Certificate. Choose one method per Secret.

Let's Encrypt secures the website, not Minikube's management API. API kubeconfig credentials still use the Minikube CA.

## Troubleshooting

```bash
kubectl -n cert-manager get pods
kubectl get clusterissuer
kubectl describe clusterissuer letsencrypt-prod
kubectl -n roboshop-ai get certificate,certificaterequest,orders,challenges
kubectl -n roboshop-ai describe certificate jithendar-com
kubectl -n cert-manager logs deployment/cert-manager --tail=100
```

- Issuer not Ready: check email, outbound HTTPS and ACME account events.
- Certificate Pending: inspect Challenge events, DNS, public port 80 and ingress class/controller.
- Staging certificate in browser: switch the Certificate's issuer to `letsencrypt-prod` and wait for reissuance.
- Local API timeout: fix the kubeconfig/API firewall connection first; cert-manager does not configure it.
- After resetting Minikube: run this installer again and recreate the site's Certificate/Ingress. Old cluster-local credentials are gone.

Documentation: [cert-manager Helm installation](https://cert-manager.io/docs/installation/helm/), [HTTP-01 solver](https://cert-manager.io/docs/configuration/acme/http01/).
