# WordPress with Redis at https://jithendar.com/

WordPress runs in the dedicated **`jithendar`** namespace and becomes the main website. Kubernetes namespace names cannot contain dots; the website domain remains **`jithendar.com`**. Grafana's more specific `/grafana` ingress remains separate. RoboShop must use another hostname/path if it currently owns `/` on `jithendar.com`; the installer reports that conflict rather than deleting its ingress.

## Deploy

On the Minikube host, from the repository root:

```bash
# Prerequisites, if not already installed:
bash minikube/deploy-traefik.sh
bash minikube/expose-ingress.sh
bash minikube/deploy-cert-manager.sh

# WordPress:
bash minikube/deploy-wordpress.sh
```

DNS must point to the Minikube host, with TCP 80/443 reachable through its firewall and the host proxy. Helm, kubectl, Python 3 and a default StorageClass are required. The cluster needs outbound access to Docker Hub and WordPress.org for images and the Redis plugin.

The installer follows the saved Minikube profile. You can run the WordPress installer from a Mac using your remote kubeconfig:

```bash
KUBE_CONTEXT=YOUR_MINIKUBE_CONTEXT bash minikube/deploy-wordpress.sh
```

The host-routing script still runs only on the Minikube host. These files do not configure local kubeconfig or SSH automatically.

## Included components

| Component | Purpose | Storage |
| --- | --- | --- |
| WordPress Apache/PHP 8.3 | Website, uploads, plugins and themes | 5 GiB PVC |
| WP-CLI sidecar | Initial setup and cache verification; same pod/volume as WordPress | Shared WordPress PVC |
| MySQL 8.4 | Posts, users, settings | 5 GiB PVC |
| Redis 7.4 | Authenticated, dedicated WordPress object cache | Disposable memory cache, 96 MiB limit |

All Services are cluster-internal. Traefik exposes only WordPress HTTPS, using its own `jithendar-com-tls` Secret in `jithendar`. The chart requests a Let’s Encrypt certificate in this namespace. Grafana retains its separate certificate and resources in `monitoring`. Redis is an **object cache**, not a full-page cache or a database replacement. The Redis Object Cache plugin uses bundled Predis, so no custom PHP image is required.

This is a single-instance Minikube deployment, not a highly available production cluster. CPU/memory requests total approximately 360m/544Mi; configured container memory limits total about 1.7 GiB. Available space and resources must also accommodate RoboShop, Grafana and Kubernetes. PVCs use the default StorageClass.

## Credentials and admin

Open **https://jithendar.com/wp-admin/**. Default administrator: `admin`, email `jithendardharmapuri@gmail.com`.
Retrieve the generated initial password (use the context printed by the installer):

```bash
kubectl -n jithendar get secret wordpress-credentials \
  -o jsonpath='{.data.admin-password}' | base64 --decode; echo
```

Change the administrator password in WordPress after first login. The Secret remains the bootstrap password and is not updated by password changes in the UI. The installer does not reset an existing WordPress account or database.

Database, database root, Redis and administrator passwords are independent random values in a Kubernetes Secret. Never commit the Secret. Preserve it with your database backups. If credentials are missing while PVCs exist, the installer stops instead of generating incompatible replacement passwords.

## Configuration and upgrades

- `values.yaml`: images, site title, administrator defaults, storage sizes and ingress. The helper/script target the `jithendar.com` certificate; changing domains also requires updating certificate/routing checks.
- `templates/`: separate database, cache, website, storage and ingress manifests.
- `bootstrap.sh`: WP-CLI initialization, plugin activation and a cross-process Redis cache test.
- `check-routes.py`: checks existing root ingress conflicts.

Official Docker images use maintenance tags; test upgrades and take backups before pulling newer images. The Redis plugin is pinned to 3.0.0 for initial installation. Existing plugins/core on the persistent volume are not silently overwritten on reruns. Apply WordPress/plugin updates through the admin UI or WP-CLI after backups. Changing an image tag alone does not upgrade the persisted WordPress core. Changing administrator defaults after initialization does not rename existing users.

Rerunning `deploy-wordpress.sh` reuses secrets and data. On a fresh installation it keeps ingress disabled until initialization, Redis verification and certificate readiness succeed. On upgrades the existing ingress stays in place. There is no HTTP redirect in this chart; use HTTPS directly.

## Verify and troubleshoot

Use the intended Kubernetes context for these commands:

```bash
kubectl -n jithendar get pods,pvc,svc,ingress
kubectl -n jithendar logs deployment/wordpress -c wordpress --tail=100
kubectl -n jithendar logs deployment/wordpress-mysql --tail=100
kubectl -n jithendar exec deployment/wordpress -c cli -- wp redis status
kubectl -n jithendar exec deployment/wordpress -c cli -- wp core is-installed
kubectl -n jithendar describe certificate jithendar-com
curl -I https://jithendar.com/
```

- **Root route conflict:** move the reported existing site's ingress to another hostname/path; don't run two `/` routes for this domain. The script checks Kubernetes Ingress resources; also review any custom Traefik IngressRoute resources you created separately.
- **PVC Pending / pod Pending:** inspect PVC/pod events for missing default storage provisioning or insufficient RAM/CPU. Do not delete data volumes to resolve scheduling problems.
- **Database access denied:** ensure the original credentials Secret matches the persisted database. Changing a Secret does not change a MySQL user's stored password.
- **Plugin download failure:** verify outbound DNS/HTTPS from the pod and rerun the installer. A failed fresh installation is not published.
- **Redis error:** inspect Redis readiness and run `wp redis status` as above. In the admin UI, look under Settings → Redis. If Redis is down and blocking the site, temporarily run `kubectl -n jithendar exec deployment/wordpress -c cli -- wp redis disable`, fix Redis, then rerun the installer to verify/re-enable it.
- **TLS Pending or external timeout:** follow the [Traefik](../traefik/README.md) and [cert-manager](../cert-manager/README.md) checks.

Back up **MySQL, the WordPress files PVC, and credentials** together before upgrades or cluster resets. PVCs have Helm's keep policy to reduce accidental loss on uninstall, but deleting the namespace/Minikube cluster can still destroy them. Redis needs no backup. Retained PVCs may need explicit Helm ownership reconciliation when reinstalling after uninstall.

References: [official WordPress image](https://hub.docker.com/_/wordpress), [Redis Object Cache installation](https://github.com/rhubarbgroup/redis-cache/blob/develop/INSTALL.md).

## Existing installation in roboshop-ai

Changing the deployment namespace does not move existing MySQL data, uploads, Secrets, or Helm releases. The installer checks for the old WordPress PVCs and stops before mutation if they exist. It also rejects the old root ingress as a competing route. Do not delete the old namespace or PVCs to bypass these checks.

For an existing site, plan a maintenance window: back up MySQL with a consistent logical dump, archive the WordPress files, and securely export `wordpress-credentials`; restore them into new PVCs and a Secret in `jithendar`. Verify the restored site privately before moving the root ingress. Preserve the old volumes and backups until the new site is verified. RoboShop resources in `roboshop-ai` and Grafana resources in `monitoring` do not need to move. This deployment script performs fresh installs and same-namespace upgrades; it does not automate cross-namespace data migration.

For a fresh cluster, run the installer normally; all WordPress resources and generated credentials are created in `jithendar`.
