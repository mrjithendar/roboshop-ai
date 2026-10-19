# Minikube on Linux and macOS

`install.sh` supports Linux amd64/arm64 and Intel/Apple Silicon Macs with Bash. It downloads missing Minikube and kubectl binaries from official release servers and verifies SHA-256 checksums. Homebrew and sudo are not required. Existing tools are preserved.

Install `curl` and either `sha256sum` (Linux coreutils) or `shasum` (included on macOS). To start a cluster, install [Docker Engine on Linux](https://docs.docker.com/engine/install/) or [Docker Desktop on macOS](https://docs.docker.com/desktop/setup/install/mac-install/). Docker must be running and accessible to your normal user (`docker info`). Follow Docker's [Linux user access instructions](https://docs.docker.com/engine/install/linux-postinstall/); Docker group membership grants root-level privileges. This script does not install Docker or change host permissions.

From the repository root:

```sh
# Install missing command-line tools only; no cluster creation.
bash minikube/install.sh install
export PATH="$HOME/.local/bin:$PATH"

# Default: one control plane and three workers.
bash minikube/install.sh start
bash minikube/install.sh status
bash minikube/install.sh stop
```

Add the PATH export to your shell startup file for future terminals. `INSTALL_DIR` can override the user-local destination with another writable absolute path. Missing tools use the latest stable release; set `MINIKUBE_VERSION=vX.Y.Z` and `KUBECTL_VERSION=vX.Y.Z` to pin downloads. These variables do not replace already installed tools. Keep kubectl compatible with your Kubernetes cluster.

The default is four nodes, each configured with 2 CPUs and 2048 MiB RAM. Allow at least 10–12 GiB RAM for Docker/host plus capacity for RobotShop workloads. For a smaller development cluster:

```sh
PROFILE=robotshop NODES=1 CPUS=2 MEMORY=3072 bash minikube/install.sh start
PROFILE=robotshop bash minikube/install.sh status
PROFILE=robotshop bash minikube/install.sh stop
```

This smaller configuration is not a guarantee that the entire RobotShop stack fits. Use a new profile when changing node topology. Stop preserves cluster data; the script never deletes clusters. On macOS it can open an installed Docker Desktop and wait for it to become ready. On Linux, start Docker yourself before running `start`.

References: [Minikube installation](https://minikube.sigs.k8s.io/docs/start/), [Docker driver](https://minikube.sigs.k8s.io/docs/drivers/docker/), [kubectl installation and checksums](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/).

## CentOS Stream 9 and 10

The same `install.sh` runs on CentOS amd64/arm64. On a fresh CentOS host, use the optional prerequisite setup from the repository root as your normal login user with sudo access:

```sh
bash minikube/setup-centos.sh
# Log out and log back in before continuing.
docker info
bash minikube/install.sh install
export PATH="$HOME/.local/bin:$PATH"
PROFILE=robotshop NODES=1 CPUS=2 MEMORY=3072 bash minikube/install.sh start
```

`setup-centos.sh` installs dependencies and Docker Engine from the official Docker RPM repository, enables Docker at boot, and adds the invoking user to the Docker group (root-level host access). DNF asks for package/key confirmation. It refuses conflicting Docker packages and `podman-docker` rather than removing them. It preserves SELinux and firewalld settings. If Docker is already working, skip this prerequisite script.

This setup targets CentOS Stream 9/10, the versions supported by [Docker's CentOS installation guide](https://docs.docker.com/engine/install/centos/). CentOS 7 and older Stream releases are not supported by this setup. Enable the default CentOS extras repository if your image has disabled it. The host needs outbound access to Docker, Minikube, Kubernetes release servers and container registries.

Troubleshooting: `sudo systemctl status docker`, `sudo journalctl -u docker --no-pager -n 50`, `id -nG`, and `docker context ls`. Run Minikube as your normal user, not with sudo. A 2 GiB host cannot accommodate the default four-node cluster; allocate more RAM or choose an appropriately sized single-node host.
