# Minikube on Linux and macOS

The scripts support amd64 and arm64. Minikube runs as the current effective user: root stays root, and a regular user stays that user. No `robotshop` account or forwarding wrappers are created.

## CentOS Stream 9/10: one command

From the repository root:

```sh
bash minikube/setup.sh
```

This installs Docker Engine from its official RPM repository, enables Docker, installs missing Minikube/kubectl binaries with SHA-256 verification, and starts the cluster. Root needs no sudo or PATH changes on a standard CentOS login. Regular users need sudo for host packages; setup refreshes Docker group membership for the cluster startup process automatically. Existing interactive sessions still need a new login for direct Docker access.

The base profile is `mk4`. Defaults are one node and 2 CPUs. Memory is sized from Docker physical RAM, reserving 1024 MiB for host overhead, rounded down to 256 MiB increments and capped at 2560 MiB per node. Swap is excluded. Hosts unable to fit at least 2048 MiB per node are rejected before cluster changes. Explicit requests exceeding the budget are also rejected. For a named development cluster:

```sh
PROFILE=robotshop NODES=1 CPUS=2 MEMORY=3072 bash minikube/setup.sh
minikube -p robotshop status
kubectl --context=robotshop get nodes
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

A `nodes "mk4-m04" not found` label error means that worker had not registered with the API server. It does not establish the underlying cause. Startup now prints diagnostics automatically and warns when total Docker memory is below configured node memory plus 2 GiB overhead. No cluster is deleted or resized automatically.

```sh
PROFILE=mk4 bash minikube/install.sh diagnose
# Inspect the failing worker's kubelet directly if its container is running:
docker exec mk4-m04 journalctl -u kubelet --no-pager -n 100
```

Check for out-of-memory kills, kubelet errors, certificate/authentication failures and API connectivity before retrying the same start command. Four nodes at 2048 MiB each request 8 GiB before host/workload overhead. To try a smaller topology, stop the old profile and use a new profile; do not delete a cluster containing data you need.

## Existing configuration and automatic adjustment

Run `bash minikube/setup.sh` or, once dependencies are installed, `bash minikube/install.sh start`. No manual resource flags are needed on the 3904 MiB host: it selects one node with 2560 MiB and 2 CPUs.

The installer inspects the selected profile's saved driver, node count, CPU and memory settings, including nodes that never successfully joined. If settings differ, it stops and preserves that profile, then starts a deterministic replacement such as `mk4-fit-1n-2560m-2c`. Existing workloads and data stay in the stopped cluster; they are **not migrated**. No nodes, clusters, or volumes are deleted. This operation interrupts workloads in the old profile.

After successful readiness checks, the selected profile is saved under `~/.minikube/robotshop-installer/`. Later `start`, `status`, `stop`, and `diagnose` calls with the same base `PROFILE` follow that selection. Use `kubectl get nodes` after startup, or the exact context printed by the installer. A failed replacement leaves the old profile preserved and stopped, with no new selection saved.

The capacity check uses total Docker RAM, not current free RAM; unrelated running workloads can still cause memory pressure. It is not a guarantee the full application fits. Tests: `python3 minikube/test-install.py` (mocked commands, no cluster required).

## Direct access from your laptop (no tunnel)

For the 4 GiB Vultr host, run with your domain pointing to the Vultr host:

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
