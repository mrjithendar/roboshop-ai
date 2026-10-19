# Minikube on Linux and macOS

The scripts support amd64 and arm64. Minikube runs as the current effective user: root stays root, and a regular user stays that user. No `robotshop` account or forwarding wrappers are created.

## Create your Vultr cluster — start here

These commands target **CentOS Stream 9/10**, running as **root**, on your **4-vCPU, 8192-MB RAM** Vultr server. They create two nodes: one control plane and one worker. Each node gets 2 CPUs and 2560 MiB RAM (5 GiB configured RAM total).

### 1. Run on Vultr

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

SELECTED_PROFILE=$(cat "$HOME/.minikube/robotshop-installer/mk4.profile")
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

After a reset, recheck the API port/firewall and rerun the helper on your Mac to obtain new credentials. Creating Minikube does not deploy the RobotShop website or issue a Let's Encrypt website certificate.

## What CentOS setup installs

This installs Docker Engine from its official RPM repository, enables Docker, installs missing Minikube/kubectl binaries with SHA-256 verification, and starts the cluster. Root needs no sudo or PATH changes on a standard CentOS login. Regular users need sudo for host packages; setup refreshes Docker group membership for the cluster startup process automatically. Existing interactive sessions still need a new login for direct Docker access.

The base profile is `mk4`. The quick-start commands explicitly select two nodes and 2 CPUs per node; use explicit resource settings to keep starts consistent. Memory is sized from Docker physical RAM, reserving 1024 MiB for host overhead, rounded down to 256 MiB increments and capped at 2560 MiB per node. Swap is excluded. Hosts unable to fit at least 2048 MiB per node are rejected before cluster changes. Explicit requests exceeding the budget are also rejected. For a named development cluster:

```sh
PROFILE=robotshop NODES=1 CPUS=2 MEMORY=2048 bash minikube/setup.sh
PROFILE=robotshop bash minikube/install.sh stop
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

CentOS setup replaces only the old RobotShop forwarding wrappers with actual binaries. Unrelated symlinks are not overwritten. Existing `robotshop` accounts and clusters are not deleted or migrated. A cluster created by that user will not appear in root's profile list; if its Docker container name conflicts, choose a distinct `PROFILE` for root.

Setup does not deploy RobotShop or guarantee the full stack fits a small host. Stop preserves cluster data.

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

After successful readiness checks, the selected profile is saved under `~/.minikube/robotshop-installer/`. Later `start`, `status`, `stop`, and `diagnose` calls with the same base `PROFILE` follow that selection. Use `kubectl get nodes` after startup, or the exact context printed by the installer. A failed replacement leaves the old profile preserved and stopped, with no new selection saved.

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

Reset does not remove clusters owned by another account, copies of kubeconfig on your laptop, or Vultr firewall rules. If you previously created clusters as `robotshop`, those belong to that account. After starting again, copy the newly exported kubeconfig and use the newly printed API port. Do not reuse the old laptop kubeconfig.

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
