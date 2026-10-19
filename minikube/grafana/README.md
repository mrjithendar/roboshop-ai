# Grafana at https://jithendar.com/grafana/

From the repository root on the Minikube host:

```bash
bash minikube/deploy-cert-manager.sh
bash minikube/deploy-grafana.sh
```

Requires Helm, kubectl, a running cluster, the **Traefik ingress controller**, and a default StorageClass (Minikube normally supplies one). DNS for `jithendar.com` must resolve to your server; public ports **80 and 443 must reach Traefik inside Minikube**. A private Minikube IP or NodePort alone does not provide this routing. These scripts do not install Traefik or configure the host firewall/load balancer. Keep port 80 reachable for automatic certificate renewal.

The script follows the installer's selected `mk4` profile. For another base profile set `PROFILE`; from your laptop with the imported kubeconfig, use `KUBE_CONTEXT=<context-name>`. All commands target that context. Example:

```bash
kubectl config get-contexts
KUBE_CONTEXT=mk4 bash minikube/deploy-grafana.sh
```

## What is deployed

- Pinned Grafana community Helm chart **14.0.1**, release `grafana`, namespace `robotshop-ai`.
- One Grafana replica with a **2 GiB persistent volume** for dashboards, users and settings. This is a single-instance sandbox deployment; back up the volume before resetting Minikube.
- A ClusterIP service and a Traefik HTTPS Ingress for `/grafana` with Prefix matching. No rewrite or StripPrefix middleware is needed. Other website paths remain available for RobotShop's own ingress.
- The shared `jithendar-com` Certificate from `../cert-manager/certificate.example.yaml`, issued by `letsencrypt-prod`, stored in `jithendar-com-tls`. Existing matching resources are updated in place. Do not also configure ingress-shim to manage this same Secret, or create another certificate controller owner for it.
- Secure cookies, anonymous access disabled, sign-up disabled, and a chart-generated random administrator password. HTTPS terminates at Traefik; in-cluster traffic to Grafana uses HTTP.

The HTTPS-only Traefik router does not add a new HTTP redirect. Open the HTTPS URL directly. An existing controller-wide HTTP-to-HTTPS redirect can remain in place.

The installer waits for both Grafana and its certificate. Cluster readiness does not verify the external firewall: check the public endpoint too:

```bash
curl -I https://jithendar.com/grafana/login
```

## Login

Username: `admin`. Retrieve the initial password using the context printed by the script:

```bash
kubectl --context=YOUR_CONTEXT -n robotshop-ai get secret grafana \
  -o jsonpath='{.data.admin-password}' | base64 --decode; echo
```

Change it after logging in. A later password change in Grafana does not update this bootstrap Secret. Rerunning the installer upgrades the release and preserves its existing Secret and volume; it does not reset your Grafana login password.

## Connect metrics

This installer deploys Grafana only; it does not install Prometheus or assume an existing metrics endpoint. In Grafana, open **Connections → Data sources → Add data source → Prometheus** and enter the actual Kubernetes Service URL. For example, only if that Service exists in that namespace: `http://prometheus.robotshop-ai.svc.cluster.local:9090`. Use **Save & test**. Docker Compose service addresses are not automatically available inside Kubernetes.

Edit `values.yaml` to configure Grafana, storage, or resources, then rerun the installer. When changing the domain/path, update the ingress, `grafana.ini.server.root_url`, and shared certificate together. Avoid changing the pinned chart version without reviewing its upgrade notes.

## Troubleshooting

Use the same context as the installer (`kubectl --context=YOUR_CONTEXT ...`):

```bash
kubectl -n robotshop-ai get pods,pvc,svc,ingress
kubectl -n robotshop-ai describe pod -l app.kubernetes.io/name=grafana
kubectl -n robotshop-ai logs deployment/grafana -c grafana --tail=100
kubectl -n robotshop-ai get certificate,certificaterequest,orders,challenges
kubectl -n robotshop-ai describe certificate jithendar-com
kubectl get ingressclass,storageclass
```

- **Missing Traefik:** install/configure the controller first; an IngressClass object alone cannot route traffic.
- **PVC Pending:** check the default StorageClass and Minikube storage-provisioner addon; inspect PVC events.
- **Certificate Pending:** inspect Challenge events; verify DNS (including any AAAA record), inbound port 80 and the issuer's Traefik HTTP-01 solver.
- **Timeout from the browser:** check Vultr and host firewalls, and host port 443 forwarding to Traefik. Kubeconfig API access is separate from website access.
- **404 or broken assets:** ensure the `/grafana` Prefix ingress uses Traefik and no proxy strips the prefix. Keep `root_url=https://jithendar.com/grafana/` and `serve_from_sub_path=true` together.
- **502/503:** inspect Grafana readiness, logs and Service endpoints.
- **No metrics:** configure a reachable Prometheus data source; Grafana does not collect metrics itself.

Configuration follows [Grafana's reverse proxy guidance](https://grafana.com/tutorials/run-grafana-behind-a-proxy/) and the [Grafana Helm installation guide](https://grafana.com/docs/grafana/latest/setup-grafana/installation/helm/).
