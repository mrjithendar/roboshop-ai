# Operational commands

Run `./init.sh` from a fresh checkout. Default `dev` installs the minimal host
editing/testing toolchain. Use a deployment profile explicitly on servers.
No init profile deploys workloads, starts Minikube, creates cloud resources,
registers runners, seeds databases or configures credentials.

```text
init.sh                         first host prerequisite entry point
scripts/setup/                  platform detection, versions, verified installers
scripts/dev/                    local process launcher, kubectl convenience command
scripts/images/                  build and publish ARM64 ECR images
scripts/deploy/                 application apply/restart command
scripts/data/                   secret-file generation, explicit synthetic seed
scripts/maintenance/            branch/history maintenance, test-order recovery
scripts/test/                   local recommendation evaluations
scripts/lib/                    Node-to-Python launcher
minikube/                       coherent deployment + chart/manifest/helper bundles
runner/                         explicit CI registration/service administration
services/<service>/             independently buildable runtime/data tools
tests/load/                    isolated lab and explicit live HTML load tests
```

See [the complete audit](script-audit.md), [machine-readable callers and variables](script-audit.json)
and [old-to-new mapping](../../scripts/path-mapping.json). Workflow shell tasks and
package scripts are included in the audit. There is no Compose dependency or
Makefile in this checkout. Go and Java builds remain containerized/service-owned;
shipping's Gradle wrapper is not relocated.

## Initialization profiles

| Profile | Dependencies | Effect |
|---|---|---|
| `dev` (default) | Git, curl, jq, Node/npm (compatible 24–26; new installs pinned 26), Python 3.14 via verified uv if no compatible `.venv` | OS prerequisites, private tools and isolated `.venv`; no application packages |
| `docker` | Git, curl, jq, Docker | OS packages and enable Linux Docker service; no group membership changes |
| `minikube` | docker profile + kubectl, Helm, Minikube, OpenSSL, bootstrap Python | Host tools only; cluster creation is separate |
| `aws` | Git, curl, jq, AWS CLI v2, Terraform >=1.10,<2; GPG for new Linux AWS installs | Private CLIs; no AWS configuration/resource changes |

Pins live in `scripts/setup/versions.json`; existing compatible versions are
preserved. Downloads use published SHA256 files; Linux AWS uses its detached
signature and the AWS CLI public key checked into setup from the official AWS
installation guide. OS packages use the distribution's signed package sources.
Supported host matrix (x86_64 and ARM64):

| Operation/profile | CentOS Stream 9/10 | Amazon Linux 2023 | Ubuntu 22.04/24.04 LTS | macOS |
| --- | --- | --- | --- | --- |
| dev | dnf + private tools | dnf + private tools | apt + private tools | existing Python/Homebrew + private tools |
| docker/minikube prerequisites | Docker CE | distro Docker | distro docker.io | existing Docker engine required |
| aws | signed CLI + Terraform | signed CLI + Terraform | signed CLI + Terraform | existing AWS v2 + private Terraform |
| client deploy/kubeconfig/secrets/maintenance | yes | yes | yes | yes |
| runner setup/SELinux repair | yes, systemd | not yet supported | not yet supported | no |
| ingress host exposure/host limits | Linux only | Linux only | Linux only | no |

Init does not install Homebrew or Docker Desktop. Missing macOS prerequisites
fail before installation; preview lists them. Linux bootstrap Python uses dnf or
apt. Normal package installation may use sudo; private downloads do not.
These paths are fixture/mock-tested, not fresh-machine validation. A successful
check confirms compatible commands, not application dependencies, daemon access,
cloud credentials, or deployment readiness. OpenSSL uses `openssl version` and
accepts OpenSSL 1.1.1 or 3.x; select OpenSSL explicitly if macOS provides LibreSSL.

`--check` executes only local version probes; exit 1 means missing/incompatible
tools. `--dry-run` prints decisions without filesystem/package changes. Neither
checks AWS permissions or cluster readiness. Incompatible tools already in PATH
produce a clear error rather than being replaced. Put the desired installation
first in PATH after reviewing it. New user tools go in `~/.local/bin`; init never
edits shell profiles. Installation errors may leave a partial private tool folder;
inspect that specific folder before removing it and retrying.

## First-time examples

Fresh CentOS Stream instance (including a CentOS image on EC2), Docker workloads:

```bash
./init.sh --profile docker --dry-run
./init.sh --profile docker
export PATH="$HOME/.local/bin:$PATH"
docker info
# Only if ECR publishing is needed:
./init.sh --profile aws
# Configure AWS access separately; init never writes credentials.
bash scripts/images/build-push-ecr.sh --dry-run frontend
```

Docker group access is root-equivalent. An administrator may explicitly grant
membership; log out/in afterwards. Never make the socket world-writable. Init
does not alter groups, firewall, SELinux or socket permissions. Docker version
checks do not prove daemon accessibility: `docker info` is a separate operator
check. Existing images are ARM64-only; x86_64 hosts can install tools but cannot
use the current ECR build command for native ARM64 images.

Fresh Minikube host:

```bash
./init.sh --profile minikube --dry-run
./init.sh --profile minikube
export PATH="$HOME/.local/bin:$PATH"
docker info
# Explicit state-changing operation, outside initialization:
PROFILE=mk4 bash minikube/install.sh start
# Application deployment also needs AWS CLI and preconfigured credentials:
./init.sh --profile aws
bash scripts/deploy/deploy-minikube.sh --dry-run frontend
```

CentOS development:

```bash
./init.sh --profile dev --check
./init.sh --profile dev --dry-run
./init.sh --profile dev
export PATH="$HOME/.local/bin:$PATH"
source .venv/bin/activate
npm ci
# Install only the Python service/test requirements needed for your task:
python -m pip install -r services/moks/requirements.txt
python -m unittest discover -s services/moks/tests
```

`dev` is a minimal editing/Python/Node testing profile, not a complete native
backend stack. `npm run dev` also needs a prebuilt shipping jar, frontend build,
configured databases and brokers. Native shipping compilation requires JDK 21+
and the service Gradle wrapper; currency compilation requires Go 1.27. Use their
Dockerfiles instead if those host runtimes are not needed. k6 remains optional:
`pythontests/load/install-k6.py` verifies the test-local pinned archive.

CI runners:

```bash
./init.sh --profile dev
./init.sh --profile aws
# Registration is a separate explicit action with its own authorization:
bash runner/setup.sh --help
```

GitHub-hosted isolated jobs retain their pinned setup actions. Runner-specific
OS libraries and service registration remain in `runner/`; init does not contact
GitHub or Secrets Manager. `runner/install-tools.sh` now requires initialized
tools instead of independently downloading/updating Python/AWS.

## Command index

| Command | Environment/profile | Side effects |
|---|---|---|
| `scripts/dev/start.mjs` | supported host; dev + backing services | starts local services |
| `scripts/dev/kubectl.sh` | supported host; minikube | passes kubectl arguments to selected config; may mutate cluster |
| `scripts/images/build-push-ecr.sh [--dry-run] [services]` | ARM64 Docker; docker + aws | builds and pushes ECR `:local` |
| `scripts/deploy/deploy-minikube.sh [--dry-run] [services]` | supported host; minikube + aws | credentials/config apply and deployment restart |
| `scripts/data/generate-secrets.py --help` | dev Python | new private output file; never overwrites existing file |
| `scripts/data/seed-minikube-demo.py --apply` | minikube + dev/pymongo | labelled synthetic database and gateway settings |
| `scripts/maintenance/reset-test-checkout.py --help` | minikube + Python | explicit test checkout retirement; existing guards preserved |
| `scripts/maintenance/delete-branches.sh [--dry-run\|--apply]` | git + authenticated gh | preview by default; apply requires DELETE and rechecks PRs |
| `scripts/maintenance/squash-history.py --help` | git + authenticated gh | preview by default; explicit apply changes remote history |
| `scripts/test/evaluate.py` | dev + Moks dependencies | fixture checks only |
| `minikube/deploy-*.sh` | minikube; some require aws | explicit cluster deployments; see each --help |
| `minikube/reset*.sh`, `remove-langfuse.sh` | minikube | explicit destructive scopes; existing confirmation guards retained |
| `runner/setup*.sh` | CentOS/systemd + dev/aws | runner registration/OS libraries/services |
| `tests/load/website.py --help` | Python + curl | live traffic only with --confirm-live |

Old public paths remain forwarding entry points, preserving arguments/exit codes.
The exceptions are deliberate safety changes: `minikube/setup.sh` no longer starts
a cluster unless `--start` is supplied; deployment dependency helpers only check;
synthetic seed requires `--apply`; branch cleanup previews without fetching/pruning
or switching branches. `run.notes.sh` and `tests/load/load-test.sh` refuse to run
whole command notebooks; examples moved to Markdown. No application modules,
service build contexts or test directories were moved.

## Regression verification

```bash
python3 -m unittest discover -s tests/scripts -v
python3 -m unittest discover -s runner -p 'test_*.py'
git diff --check
```

The script tests export tracked working-tree files to a temporary directory with
spaces, validate every path mapping and run ECR help/preview offline. New source
files must be in the Git index for completeness tests to pass. No commit is made.
Generated `**/build/` artifacts remain ignored; source lives in `scripts/images/`.
