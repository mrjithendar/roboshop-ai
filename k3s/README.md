# K3s on four Vultr instances

This creates **one server and three workers**, all in the same Vultr region and
VPC. It does not create Vultr instances, migrate Minikube data, or deploy RobotShop.
The control plane is not highly available: if the server fails, cluster management
is unavailable. Three servers with embedded etcd would be a separate HA topology.

Use fresh Ubuntu/Debian or CentOS Stream/Rocky Linux systemd hosts. Root is supported;
for other users use sudo. The scripts use native K3s/containerd, not Docker.
Allow at least 2 vCPU/2 GB for the server and 1 vCPU/1 GB per worker for K3s alone;
RobotShop databases and monitoring need additional capacity. Prefer 4 GB or more
per worker for this application and size from actual resource requests.

## 1. Prepare VPC and firewall

Create four instances and attach all four to the same Vultr VPC. Configure the VPC
interface on each host using Vultr's instance network instructions. Run `ip -4 addr`
to find its private IP and interface name. Use unique node names.

Example addresses below are placeholders—replace them with your actual VPC IPs:

| Host | Private IP | Name |
|---|---|---|
| Server | 10.10.0.10 | k3s-server |
| Worker 1 | 10.10.0.11 | k3s-worker-1 |
| Worker 2 | 10.10.0.12 | k3s-worker-2 |
| Worker 3 | 10.10.0.13 | k3s-worker-3 |

Configure both Vultr Firewall and any host firewall:

| Traffic | Allow from | Destination |
|---|---|---|
| TCP 22 | Your admin IP | All hosts |
| TCP 6443 | Worker VPC IPs and your admin IP | Server |
| UDP 8472 (Flannel) | The four node VPC IPs only | All hosts |
| TCP 10250 (kubelet) | The four node VPC IPs only | All hosts |
| TCP 80,443 | Website visitors | Hosts serving ingress |

Never expose UDP 8472 or kubelet port 10250 publicly. Allow node/pod forwarding
for pod CIDR `10.42.0.0/16` and service CIDR `10.43.0.0/16` through the host
firewall. Those ranges must not overlap the VPC. Allow outbound DNS, HTTPS image
pulls/downloads and time synchronization. The scripts do not disable firewalls or
SELinux. Use the official K3s requirements for distro-specific firewalld/UFW rules.

## 2. Install server

Copy this repository (or the `k3s` directory) to each host. On the server, replace
`ens7` with its VPC interface:

```bash
sudo env API_HOST=k3s.jithendar.com bash k3s/install.sh server 10.10.0.10 ens7 k3s-server
sudo k3s --version
sudo cat /var/lib/rancher/k3s/server/node-token
```

Create a DNS-only `k3s.jithendar.com` record pointing to the server public IP for
remote administration. Do not proxy this API hostname through Cloudflare. The
installer adds this hostname to the API certificate. Website DNS is separate;
this does not change `jithendar.com` or its current Minikube application.

The first server install selects the official stable channel. Optionally set
`K3S_VERSION=vX.Y.Z+k3sN` to pin a supported release. Use the **exact version printed
by the server** for all workers. Keep the join token private; do not commit it.

## 3. Join three workers

On each worker, run its command with the server's version (replace `vX.Y.Z+k3sN`):

```bash
# Worker 1
sudo env K3S_VERSION='vX.Y.Z+k3sN' bash k3s/install.sh agent 10.10.0.11 ens7 k3s-worker-1 10.10.0.10
# Worker 2
sudo env K3S_VERSION='vX.Y.Z+k3sN' bash k3s/install.sh agent 10.10.0.12 ens7 k3s-worker-2 10.10.0.10
# Worker 3
sudo env K3S_VERSION='vX.Y.Z+k3sN' bash k3s/install.sh agent 10.10.0.13 ens7 k3s-worker-3 10.10.0.10
```

Each command prompts privately for the server join token. For automation, provide
`JOIN_TOKEN_FILE=/root/private-node-token` through `sudo env` instead of typing it.
The installer stores the token root-only. Do not enable shell tracing.

On the server:

```bash
sudo k3s kubectl get nodes -o wide
sudo k3s kubectl wait --for=condition=Ready node --all --timeout=180s
sudo k3s kubectl get pods -A
```

Confirm **four** nodes are listed before proceeding. Wait only checks registered
nodes; a missing worker needs its installation fixed first.

## 4. Access from your Mac/Linux workstation

Install kubectl locally, then run:

```bash
bash k3s/kubeconfig.sh root@SERVER_PUBLIC_IP k3s.jithendar.com
kubectl --kubeconfig="$HOME/.kube/vultr-k3s.yaml" get nodes
```

This verifies connectivity and saves a separate file/context (`vultr-k3s`), leaving
your Minikube/default kubeconfig unchanged. No export command is needed. The file
contains cluster-admin credentials; keep it private. A non-root SSH user needs
passwordless sudo for reading `/etc/rancher/k3s/k3s.yaml`.

## Application prerequisites

K3s bundles Traefik, ServiceLB, metrics-server and local-path storage. Do not install
another ingress controller or metrics-server over those components. Cert-manager,
application secrets, ECR pull credentials and databases still need configuring.
Local-path volumes are node-local, not replicated or automatically migrated.
Minikube PVCs will not appear here; arrange database backups/restores separately.
The existing deployment workflow assumes a prepared cluster and must not be run
against this fresh cluster until those prerequisites are configured. Minikube-specific
storage classes and node selectors need review before applying application YAML.

## Troubleshooting and recovery

```bash
# Server
sudo systemctl status k3s
sudo journalctl -u k3s -n 100 --no-pager
# Worker
sudo systemctl status k3s-agent
sudo journalctl -u k3s-agent -n 100 --no-pager
# From the server
sudo k3s kubectl get events -A --sort-by=.lastTimestamp
```

- **Worker missing:** check its exact K3s version, join token, VPC address/interface,
  routes and TCP 6443 to the server.
- **Nodes Ready but cross-node traffic fails:** check private UDP 8472 and host
  forwarding rules. Verify there is no VPC/pod/service CIDR overlap.
- **Remote API times out:** check DNS-only record, admin source IP firewall rule,
  server port 6443 and server service state.
- **Certificate hostname error:** API_HOST must match the export hostname. Inspect
  `tls-san` in `/etc/rancher/k3s/config.yaml`; changing it requires a deliberate
  server configuration update/restart, not reinstallation.
- **Existing configuration found:** intentional safeguard. Rerunning does not
  overwrite nodes or upgrade them. After a partial install inspect config and
  journal first. Do not delete `/var/lib/rancher/k3s` to fix an error.
- **Installation failed after configuration was written:** retain the configuration
  and token. Review/fix the cause, then retry the official installer with the same
  version and explicit `INSTALL_K3S_EXEC=server` or `agent`; it reads the saved config.
- Back up server datastore and token together, and back up application volumes
  separately. Do not run the K3s uninstall scripts unless intentionally deleting
  that node and its local data. This directory provides no automatic wipe operation.

References: [K3s requirements](https://docs.k3s.io/installation/requirements),
[quick start](https://docs.k3s.io/quick-start),
[configuration](https://docs.k3s.io/installation/configuration),
[backup and restore](https://docs.k3s.io/datastore/backup-restore).
