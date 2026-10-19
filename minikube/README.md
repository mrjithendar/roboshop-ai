# Minikube on Linux and macOS

The scripts support amd64 and arm64. Minikube runs as the current effective user: root stays root, and a regular user stays that user. No `robotshop` account or forwarding wrappers are created.

## CentOS Stream 9/10: one command

From the repository root:

```sh
bash minikube/setup-centos.sh
```

This installs Docker Engine from its official RPM repository, enables Docker, installs missing Minikube/kubectl binaries with SHA-256 verification, and starts the cluster. Root needs no sudo or PATH changes on a standard CentOS login. Regular users need sudo for host packages; setup refreshes Docker group membership for the cluster startup process automatically. Existing interactive sessions still need a new login for direct Docker access.

The base profile is `mk4`. Defaults are one node and 2 CPUs. Memory is sized from Docker physical RAM, reserving 1024 MiB for host overhead, rounded down to 256 MiB increments and capped at 2560 MiB per node. Swap is excluded. Hosts unable to fit at least 2048 MiB per node are rejected before cluster changes. Explicit requests exceeding the budget are also rejected. For a named development cluster:

```sh
PROFILE=robotshop NODES=1 CPUS=2 MEMORY=3072 bash minikube/setup-centos.sh
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

Run `bash minikube/setup-centos.sh` or, once dependencies are installed, `bash minikube/install.sh start`. No manual resource flags are needed on the 3904 MiB host: it selects one node with 2560 MiB and 2 CPUs.

The installer inspects the selected profile's saved driver, node count, CPU and memory settings, including nodes that never successfully joined. If settings differ, it stops and preserves that profile, then starts a deterministic replacement such as `mk4-fit-1n-2560m-2c`. Existing workloads and data stay in the stopped cluster; they are **not migrated**. No nodes, clusters, or volumes are deleted. This operation interrupts workloads in the old profile.

After successful readiness checks, the selected profile is saved under `~/.minikube/robotshop-installer/`. Later `start`, `status`, `stop`, and `diagnose` calls with the same base `PROFILE` follow that selection. Use `kubectl get nodes` after startup, or the exact context printed by the installer. A failed replacement leaves the old profile preserved and stopped, with no new selection saved.

The capacity check uses total Docker RAM, not current free RAM; unrelated running workloads can still cause memory pressure. It is not a guarantee the full application fits. Tests: `python3 minikube/test-install.py` (mocked commands, no cluster required).
