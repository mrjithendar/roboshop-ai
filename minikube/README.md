# Minikube on Linux and macOS

The scripts support amd64 and arm64. Minikube runs as the current effective user: root stays root, and a regular user stays that user. No `robotshop` account or forwarding wrappers are created.

## CentOS Stream 9/10: one command

From the repository root:

```sh
bash minikube/setup-centos.sh
```

This installs Docker Engine from its official RPM repository, enables Docker, installs missing Minikube/kubectl binaries with SHA-256 verification, and starts the cluster. Root needs no sudo or PATH changes on a standard CentOS login. Regular users need sudo for host packages; setup refreshes Docker group membership for the cluster startup process automatically. Existing interactive sessions still need a new login for direct Docker access.

The default profile is `mk4`, with four nodes, 2 CPUs and 2048 MiB per node. Allow at least 10–12 GiB host RAM plus capacity for workloads. For a smaller development host:

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

Optional overrides: `PROFILE`, `NODES`, `CPUS`, `MEMORY` (MiB/node), and standalone `INSTALL_DIR`. `MINIKUBE_VERSION=vX.Y.Z` and `KUBECTL_VERSION=vX.Y.Z` pin missing-tool downloads; existing installations are retained. Without pins, missing tools use current stable releases. Use a new profile when changing node topology.

## Root behavior and upgrades from earlier scripts

Linux root startup automatically supplies Minikube's `--force` flag because the Docker driver normally rejects root. This flag bypasses some Minikube checks; use this setup for development clusters. Cluster state and kubeconfig belong to the current user (`/root/.minikube` and `/root/.kube` for root), with no switching to another account.

CentOS setup replaces only the old RobotShop forwarding wrappers with actual binaries. Unrelated symlinks are not overwritten. Existing `robotshop` accounts and clusters are not deleted or migrated. A cluster created by that user will not appear in root's profile list; if its Docker container name conflicts, choose a distinct `PROFILE` for root.

Setup does not deploy RobotShop or guarantee the full stack fits a small host. Stop preserves cluster data.

References: [Docker on CentOS](https://docs.docker.com/engine/install/centos/), [Minikube installation](https://minikube.sigs.k8s.io/docs/start/), [start flags](https://minikube.sigs.k8s.io/docs/commands/start/).
