kubectl -n monitoring get secret prometheus-auth \

> Linux and macOS clients are supported; see [the script matrix](../docs/operations/scripts.md).


  -o jsonpath='{.data.password}' | base64 --decode; echo

# Minikube on Linux and macOS

The scripts support amd64 and arm64. Minikube runs as the current effective user: root stays root, and a regular user stays that user. No `roboshop` account or forwarding wrappers are created.

## Create your Vultr cluster — start here

These commands target **CentOS Stream 9/10**, running as **root**, on your **4-vCPU, 8192-MB RAM** Vultr server. They create two nodes: one control plane and one worker. Each node gets 2 CPUs and 2560 MiB RAM (5 GiB configured RAM total).

### 1. Run on VM

Use the updated repository on the server:

```bash
cd ~/roboshop-ai
PUBLIC_HOST=jithendar.com PROFILE=mk4 NODES=3 CPUS=2 MEMORY=2560 \
  bash minikube/setup.sh
```

No separate Docker installation, user switching, or `chmod` step is needed on the supported CentOS setup. Wait until both nodes are Ready and the installer prints `Direct API: https://jithendar.com:PORT`. If it exits with an error, resolve that error before importing the kubeconfig on your Mac.

**If a profile already exists with different settings, the script may stop and preserve it and create a replacement. Existing workloads are not migrated.** The base profile remains `mk4`; the actual selected name may have a suffix.

### 2. Verify on Vultr

```bash
kubectl get nodes
kubectl get pods -A
PROFILE=mk4 bash minikube/install.sh status

SELECTED_PROFILE=$(cat "$HOME/.minikube/roboshop-installer/mk4.profile")
docker port "$SELECTED_PROFILE" 8443/tcp
```

The last command should include `0.0.0.0:PORT`. That is the published management API port. It is **not** necessarily 8443, and it is separate from website ports 80/443.

### 3. Allow direct API access

Ensure `jithendar.com` resolves directly to this Vultr server. In the Vultr firewall attached to the instance, allow the printed **TCP API port from your Mac's public IP**. A website reverse proxy does not forward this arbitrary Kubernetes API port. Check any host firewall too.

### 4. Run on your Mac

From the local repository, using its updated helper:

```bash
sh minikube/kubeconfig.sh
export KUBECONFIG="$HOME/.kube/vultr-minikube.json"
kubectl get nodes
kubectl get pods -A
```

Run the export only after the helper succeeds. The helper requires local `ssh`, `python3` and `kubectl`; it discovers the selected profile and checks direct connectivity before replacing the local config. It does not start an SSH tunnel. Repeat the export in new terminal sessions, or use `kubectl --kubeconfig="$HOME/.kube/vultr-minikube.json" get nodes`.

### 5. Later start / stop — on Vultr

```bash
# Start or resume with the same configuration.
PUBLIC_HOST=jithendar.com PROFILE=mk4 NODES=2 CPUS=2 MEMORY=2560 \
  bash minikube/install.sh start

# Stop, preserving data.
PROFILE=mk4 bash minikube/install.sh stop

# Troubleshoot.
PROFILE=mk4 bash minikube/install.sh diagnose
```

Use the script for starting as root; bare `minikube start` does not add `--force` or follow the installer's selected profile.

### Optional: erase old clusters before creating a fresh one

**Destructive: deletes all current-user Minikube clusters and their cluster-local data, without a confirmation prompt. Skip this if you need to retain them.**

```bash
cd ~/roboshop-ai
bash minikube/install.sh reset
PUBLIC_HOST=jithendar.com PROFILE=mk4 NODES=2 CPUS=2 MEMORY=2560 \
  bash minikube/setup.sh
```

After a reset, recheck the API port/firewall and rerun the helper on your Mac to obtain new credentials. Creating Minikube does not deploy the RoboShop website or issue a Let's Encrypt website certificate.

## What CentOS setup installs

This installs Docker Engine from its official RPM repository, enables Docker, installs missing Minikube/kubectl binaries with SHA-256 verification, and starts the cluster. Root needs no sudo or PATH changes on a standard CentOS login. Regular users need sudo for host packages; setup refreshes Docker group membership for the cluster startup process automatically. Existing interactive sessions still need a new login for direct Docker access.

The base profile is `mk4`. The quick-start commands explicitly select two nodes and 2 CPUs per node; use explicit resource settings to keep starts consistent. Memory is sized from Docker physical RAM, reserving 1024 MiB for host overhead, rounded down to 256 MiB increments and capped at 2560 MiB per node. Swap is excluded. Hosts unable to fit at least 2048 MiB per node are rejected before cluster changes. Explicit requests exceeding the budget are also rejected. For a named development cluster:

```sh
PROFILE=roboshop NODES=1 CPUS=2 MEMORY=2048 bash minikube/setup.sh
PROFILE=roboshop bash minikube/install.sh stop
```

Use `--install-only` to install without starting. `--start` remains accepted. Docker package installation is noninteractive and uses the repository's package signature checks. Conflicting runtime packages are reported instead of removed. SELinux and firewalld settings are preserved. Docker group membership grants root-level host access.

## Other Linux and macOS hosts

Install Docker Engine on Linux or Docker Desktop on macOS first, then:

```sh
bash minikube/install.sh install
bash minikube/install.sh start
bash minikube/install.sh status
bash minikube/install.sh stop
```

The standalone installer defaults to `/usr/local/bin` for root and `~/.local/bin` for regular users; it adds that path internally for every action. For direct CLI use outside the standalone script, the installation directory must already be on your shell PATH. CentOS setup publishes tools into `/usr/local/bin`, on the standard CentOS PATH, automatically. On macOS run as a regular user; the script opens an installed Docker Desktop when needed.

Optional overrides: `PROFILE`, `NODES`, `CPUS`, `MEMORY` (MiB/node), and standalone `INSTALL_DIR`. `MINIKUBE_VERSION=vX.Y.Z` and `KUBECTL_VERSION=vX.Y.Z` pin missing-tool downloads; existing installations are retained. Without pins, missing tools use current stable releases. The installer checks the saved profile configuration before starting (requires `jq`, installed by CentOS setup).

## Root behavior and upgrades from earlier scripts

Linux root startup automatically supplies Minikube's `--force` flag because the Docker driver normally rejects root. This flag bypasses some Minikube checks; use this setup for development clusters. Cluster state and kubeconfig belong to the current user (`/root/.minikube` and `/root/.kube` for root), with no switching to another account.


Setup does not deploy RoboShop or guarantee the full stack fits a small host. Stop preserves cluster data.

References: [Docker on CentOS](https://docs.docker.com/engine/install/centos/), [Minikube installation](https://minikube.sigs.k8s.io/docs/start/), [start flags](https://minikube.sigs.k8s.io/docs/commands/start/).

## Failed worker join

A `nodes "mk4-m04" not found` label error means that worker had not registered with the API server. It does not establish the underlying cause. Startup prints diagnostics automatically; the capacity check reserves 1024 MiB of Docker memory for host overhead and rejects allocations exceeding that budget. No cluster is deleted or resized automatically.

```sh
PROFILE=mk4 bash minikube/install.sh diagnose
# Inspect the failing worker's kubelet directly if its container is running:
docker exec mk4-m04 journalctl -u kubelet --no-pager -n 100
```

Check for out-of-memory kills, kubelet errors, certificate/authentication failures and API connectivity before retrying the same start command. Four nodes at 2048 MiB each request 8 GiB before host/workload overhead. To try a smaller topology, stop the old profile and use a new profile; do not delete a cluster containing data you need.

## Existing configuration and automatic adjustment

Run `bash minikube/setup.sh` or, once dependencies are installed, `bash minikube/install.sh start`. On an older 3904 MiB host, explicitly set `NODES=1 CPUS=2 MEMORY=2560`; the two-node quick start is for the upgraded 8 GiB host.

The installer inspects the selected profile's saved driver, node count, CPU and memory settings, including nodes that never successfully joined. If settings differ, it stops and preserves that profile, then starts a deterministic replacement such as `mk4-fit-1n-2560m-2c`. Existing workloads and data stay in the stopped cluster; they are **not migrated**. No nodes, clusters, or volumes are deleted. This operation interrupts workloads in the old profile.

After successful readiness checks, the selected profile is saved under `~/.minikube/roboshop-installer/`. Later `start`, `status`, `stop`, and `diagnose` calls with the same base `PROFILE` follow that selection. Use `kubectl get nodes` after startup, or the exact context printed by the installer. A failed replacement leaves the old profile preserved and stopped, with no new selection saved.

The capacity check uses total Docker RAM, not current free RAM; unrelated running workloads can still cause memory pressure. It is not a guarantee the full application fits. Tests: `python3 minikube/test-install.py` (mocked commands, no cluster required).

## Direct access from your laptop (no tunnel)

For the upgraded 8 GiB Vultr host, run with your domain pointing to the Vultr host:

```sh
PUBLIC_HOST=jithendar.com NODES=1 bash minikube/setup.sh
# Or, with dependencies already installed:
PUBLIC_HOST=jithendar.com NODES=1 bash minikube/install.sh start
```

The installer binds Docker's published API port to `0.0.0.0`, includes the DNS hostname in the API certificate, and writes `~/.kube/<selected-profile>-direct.json` with embedded credentials and file permissions 0600. TLS verification remains enabled. It prints the actual port and exact `scp` and local `kubectl` commands. Allow that TCP port from your laptop's public IP in Vultr Firewall (and any other upstream firewall); the script does not manage your Vultr account. No SSH tunnel is required after copying the file.

A profile created for localhost access cannot simply change its Docker port bindings. The installer stops and preserves it, and creates a separate direct-access profile when needed. Workloads are not migrated. Reuse the same `PUBLIC_HOST` on subsequent starts; omitting it requests local-only access. Re-export the file after recreating the cluster or changing the hostname. The exported file grants cluster administrator access; keep it private and out of Git.

## Wipe Minikube and start fresh

On the Vultr host, as the user who created the clusters:

```sh
bash minikube/install.sh reset
PUBLIC_HOST=jithendar.com NODES=1 bash minikube/setup.sh
```

`bash minikube/reset.sh` is equivalent to the reset action. It immediately runs `minikube delete --all --purge`: all current-user Minikube clusters and their cluster-local data are deleted, along with cached downloads, profiles, installer selection/network metadata and matching direct-access exports. There is no interactive confirmation. It retains installed tools, unrelated Docker resources, and unrelated Kubernetes contexts. It requires the standard non-symlink `~/.minikube` directory.

Reset does not remove clusters owned by another account, copies of kubeconfig on your laptop, or Vultr firewall rules. If you previously created clusters as `roboshop`, those belong to that account. After starting again, copy the newly exported kubeconfig and use the newly printed API port. Do not reuse the old laptop kubeconfig.

### Domain endpoint: jithendar.com

Use `PUBLIC_HOST=jithendar.com NODES=1 bash minikube/setup.sh`. The installer adds `jithendar.com` as a DNS certificate SAN and exports `https://jithendar.com:<published-port>`. It prints the exact port and local copy command; TLS verification stays enabled. `PUBLIC_IP` is still supported for IPv4 endpoints, but do not set both variables.

The domain must resolve directly to your Vultr host. A normal website HTTP reverse proxy does not forward this Kubernetes API port; use a direct DNS record. Existing website ports 80/443 are unchanged. If the main domain must stay behind a website proxy, use a dedicated DNS hostname such as `k8s.jithendar.com` instead. The Vultr firewall still needs to allow the printed TCP port from your local public IP.

### Import directly from your Mac with the helper

```bash
sh minikube/kubeconfig.sh
export KUBECONFIG="$HOME/.kube/vultr-minikube.json"
kubectl get nodes
```

The helper uses one SSH connection to discover the selected `mk4` profile, read its published Docker API port, and export current embedded certificates. It does not require a pre-existing `*-direct.json` file and does not create a tunnel. It checks direct API connectivity before replacing the local file. SSH, malformed export, or API failures preserve the existing file and stop execution; they never fall back to a stale tunnel endpoint.

Overrides: `VULTR_HOST=root@jithendar.com`, `API_HOST=jithendar.com`, `PROFILE=mk4`, and `CONFIG=/absolute/local/path`. The remote cluster must already publish its API on `0.0.0.0`, and its port must be reachable through the Vultr firewall. The helper preserves the original certificate identity using `tls-server-name`, while changing the connection address to the public domain; TLS verification stays enabled. Shell scripts cannot export variables into their parent shell, so run the printed `export KUBECONFIG=...` command after success.

If local import says the profile has no public API binding, read the actual binding printed by the helper. `127.0.0.1:PORT` is host-local and cannot be reached from your laptop. On Vultr, run `PUBLIC_HOST=jithendar.com NODES=2 CPUS=2 MEMORY=2560 bash minikube/install.sh start` and wait for the `Direct API:` message. This can preserve/stop the local-only profile and create a replacement; workloads are not migrated. The installer now saves a new profile selection only after the requested direct-access export succeeds, and later starts retain its saved hostname.

### Kubeconfig helper files

- `kubeconfig.sh`: connects over SSH, discovers the profile/port, manages temporary files, checks connectivity and installs the local config.
- `kubeconfig.py`: validates the exported JSON, sets the public endpoint and preserves TLS certificate verification. It performs no SSH or Kubernetes calls.

Keep both files together. Normal usage remains `sh minikube/kubeconfig.sh`. To see the Python helper's arguments, run `python3 minikube/kubeconfig.py --help`.

## Install cert-manager and Let's Encrypt

```bash
bash minikube/deploy-cert-manager.sh
```

This installs cert-manager with Helm and configures `letsencrypt-staging` and `letsencrypt-prod` ClusterIssuers. It follows the selected Minikube profile. See [cert-manager setup](cert-manager/README.md) for the email/ingress settings, `jithendar.com` certificate example and troubleshooting. An ingress controller and public port 80 are required before requesting certificates; this command does not deploy the website.

## Grafana over HTTPS

Run on the Vultr Minikube host (see [Traefik setup](traefik/README.md) for Mac/remote instructions):

```bash
bash minikube/deploy-traefik.sh
bash minikube/expose-ingress.sh
bash minikube/deploy-cert-manager.sh
bash minikube/deploy-grafana.sh
```

Open **https://jithendar.com/grafana/**. The installer deploys Grafana with Helm, persistent storage, and the shared Let's Encrypt website certificate. It requires Traefik with publicly reachable ports 80/443 and correct DNS. See [Grafana setup](monitoring/grafana/README.md) for login credentials, prerequisites, metrics configuration and troubleshooting.

## WordPress with Redis

After Traefik, host routing and cert-manager are ready:

```bash
bash minikube/deploy-wordpress.sh
```

WordPress runs in namespace **`jithendar-com`** and serves **https://jithendar.com/**; Grafana keeps **/grafana/**. Includes MySQL, persistent site/database volumes, random credentials and verified Redis object caching. See [WordPress setup](wordpress/README.md) for installation, administrator login, backup requirements and troubleshooting.

## Prometheus over HTTPS

```bash
bash minikube/deploy-prometheus.sh
bash minikube/deploy-grafana.sh
```

Prometheus runs in `monitoring` at **https://jithendar.com/prometheus/** with persistent storage and a generated login password. Rerunning the Grafana installer provisions its internal Prometheus data source. See [Prometheus setup](monitoring/prometheus/README.md) for credentials, scrape targets and troubleshooting.

Grafana and Prometheus both install in the **`monitoring`** namespace and share its TLS certificate. See [monitoring namespace notes](monitoring/README.md) before changing an existing installation.

To **delete all Grafana/Prometheus data and login credentials, then reinstall**, use `bash minikube/reset-monitoring.sh`. This deletes only their resources in `monitoring` and legacy `roboshop-ai`, then reinstalls in `monitoring`; namespaces, TLS and other workloads are preserved. See [monitoring reset details](monitoring/README.md#delete-all-monitoring-data-and-reinstall).

## Kubernetes CPU/memory metrics

```bash
bash minikube/deploy-metrics-server.sh
kubectl top nodes
kubectl top pods -A
```

Installs Metrics Server in `kube-system` for `kubectl top` and resource-based HPA metrics. See [Metrics Server setup](metrics-server/README.md).

## Deploy RoboShop application services

From the repository root, use `bash scripts/deploy/deploy-minikube.sh` to apply each service's `*-minikube.yaml` in dependency order. See [application deployment](roboshop/README.md) for building/loading images, remote deployment and configuration.

RoboShop is served at **https://jithendar.com/roboshop/** using the root `scripts/deploy/deploy-minikube.sh` script. See [HTTPS routing and rebuild instructions](roboshop/README.md#https-access-at-jithendarcomroboshop). WordPress continues serving the domain root.

### Use the downloaded kubeconfig without exporting it

From the repository root:

```bash
bash scripts/dev/kubectl.sh get nodes
bash scripts/dev/kubectl.sh -n roboshop-ai get pods
bash scripts/deploy/deploy-minikube.sh
```

`scripts/dev/kubectl.sh` uses `~/.kube/vultr-minikube.json` and fails clearly if it is missing. The deployment script also selects this file when present; on the Minikube host it falls back to the usual kubectl configuration. Both respect an existing `KUBECONFIG`. Neither changes your shell or overwrites `~/.kube/config`. Plain `kubectl` commands still use your shell's configuration.

## JFrog artifact and Docker registry

See [JFrog setup](jfrog/README.md) for the pinned Helm installation, DNS, storage,
credentials and image publishing. Run `bash minikube/deploy-jfrog.sh --check`
before installation. Its public UI is `https://jfrog.jithendar.com/ui/` with a
`https://jithendar.com/jfrog` redirect. The standard profile requires a larger host. An explicit `JFROG_SIZE=minimal`
profile is available for below-vendor-sizing sandbox experiments; see its memory
budget and limitations in the JFrog README.

## SES email and password reset

User-service sends five-minute password-reset codes through Amazon SES on port
587. See [SES infrastructure setup](../infrastructure/README.md#amazon-ses-transactional-email)
and [user-service configuration](../services/user-service/README.md). The former
self-hosted SMTP microservice has been removed.

## Networking startup fails with `fsnotify watcher init: too many open files`

Linux `install.sh start` (also called by `setup.sh`) now checks host inotify
limits before changing/starting clusters. Low limits are raised to at least
1,024 instances and 1,048,576 watches and persisted in
`/etc/sysctl.d/99-minikube-inotify.conf`. Existing higher values are preserved.
Root runs directly; regular users need sudo when limits need raising. macOS is
unchanged. This helper must run on the Docker host, not a remote Docker client.
A failed read or apply stops startup; it does not reset clusters or restart Docker.

For an already running cluster, apply just the host fix:

```bash
cd ~/roboshop-ai
bash minikube/host-limits.sh
```

Then recreate the failed node's kube-proxy and kindnet pods (their DaemonSets
recreate them automatically):

```bash
kubectl --context=mk4 -n kube-system delete pods \
  --field-selector spec.nodeName=mk4-m04 -l k8s-app=kube-proxy
kubectl --context=mk4 -n kube-system delete pods \
  --field-selector spec.nodeName=mk4-m04 -l app=kindnet
kubectl --context=mk4 wait --for=condition=Ready node/mk4-m04 --timeout=180s
```

If a selector matches no pods, inspect `kubectl -n kube-system get pods --show-labels`
and select the affected pod by name. If the error persists with sufficient inotify
limits, inspect process file-descriptor limits and current pod logs; this message
can also indicate descriptor exhaustion. Do not copy another node's CNI configuration.

### Import Minikube into the default local kubeconfig

Run on your Mac:

```bash
sh minikube/kubeconfig.sh
unset KUBECONFIG
kubectl get nodes
k9s
```

The importer fetches fresh embedded certificates over SSH, verifies direct API
access, then merges Minikube into `~/.kube/config` and selects its context.
Existing unrelated clusters/users/contexts are preserved. Matching Minikube names
are refreshed, and the previous file is backed up alongside it with private
permissions. SSH or connection-check failures leave the original file unchanged.
`CONFIG=/path/to/file` overrides the merge destination.

To import an already downloaded JSON kubeconfig without SSH or an API check:

```bash
python3 minikube/kubeconfig.py --merge "$HOME/.kube/vultr-minikube.json" "$HOME/.kube/config"
```

This offline import does not fix expired certificates or blocked API ports.

### Argo CD

Run `bash minikube/deploy-argocd.sh` to install Argo CD at
`https://jithendar.com/argocd/` using the existing Traefik and Let's Encrypt issuer.
See [Argo CD setup and troubleshooting](argocd/README.md) for login and CLI commands.

## Langfuse AI tracing

Use Langfuse Cloud; no Langfuse database or dashboard runs in Minikube.
Connect an existing Cloud project Secret with `bash minikube/connect-langfuse.sh`.
Requires Helm 4.3.1+; setup and connection commands are in
[Langfuse deployment and trace guide](langfuse/README.md).

## Shared jithendar.com certificate

Use `bash minikube/setup-shared-tls.sh` to reuse the ready WordPress certificate
for Argo CD, monitoring and RoboShop without new ACME requests. See
[shared TLS migration and renewal](shared-tls/README.md). This replaces the older
per-namespace certificate instructions for this hostname.
