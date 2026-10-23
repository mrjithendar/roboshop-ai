# Runner prerequisites

> See [the script matrix](../docs/operations/scripts.md). Runner host setup remains CentOS Stream 9/10 with systemd.



Before runner registration, run `./init.sh --profile dev` and
`./init.sh --profile aws` as the runner owner. Existing compatible Python/AWS
installations are reused; `runner/install-tools.sh` creates private links and an
isolated runner venv only. It no longer downloads uv/AWS, overwrites system AWS,
or edits shell profiles. Runner setup still installs CI-specific OS libraries
and registers/starts the runner explicitly; it is never called by init.

# GitHub Actions runner

Run from the checkout as root or your regular Linux user (for example `ec2-user` or `ubuntu`):

```bash
bash runner/setup.sh mrjithendar/roboshop-ai mrjithendar-github-pat us-east-1
```

This installs one job slot; keep the entire `runner/` directory together. With no arguments, the same repository, secret and region are used.

| Argument | Purpose |
| --- | --- |
| `mrjithendar/roboshop-ai` | GitHub repository in OWNER/REPOSITORY format |
| `mrjithendar-github-pat` | AWS Secrets Manager secret holding a GitHub token |
| `us-east-1` | AWS region containing that secret |

Setup retains CI-specific OS runtime libraries. Run the central initializer for
Python/Node and AWS prerequisites first. `install-tools.sh` reuses the repository
Python environment to create a private runner venv and links the selected AWS CLI
v2 into `$RUNNER_DIR/.tools`. It never downloads independent tool versions, edits
shell profiles or replaces a global command. The runner `.path` file selects these
private tools for jobs. AWS credentials remain separately managed by the operator.

For an existing runner, wait until GitHub shows **Idle**, then stop its service
before updating tools:

```bash
cd "$HOME/actions-runner"
sudo ./svc.sh stop
cd /path/to/roboshop-ai
bash runner/setup.sh mrjithendar/roboshop-ai mrjithendar-github-pat us-east-1
```

Setup refuses to update tools while that service is active. It restarts the service
after successful setup. Reruns reuse healthy private Python, pip and AWS CLI v2 installations;
install project dependencies in project virtual environments or workflow steps.
They preserve runner registration and do not fetch a new GitHub secret for an
already registered runner. If tool installation or registration configuration fails, the service remains stopped until fixed.


When working runner files are absent, the installer downloads runner 2.337.0 and verifies its pinned SHA-256 checksum. Initial registration uses GH_TOKEN/GITHUB_TOKEN, then an authenticated GitHub CLI login, then the specified AWS secret as a legacy fallback. The AWS identity needs `secretsmanager:GetSecretValue` (plus KMS decrypt permission for a customer-managed key). Provide an EC2 instance role or configure AWS credentials/profile for your user before running. The installer does not create GitHub access tokens or AWS credentials. Outbound HTTPS to package repositories, GitHub, AWS and PyPI, astral.sh, python-build-standalone release downloads and awscli.amazonaws.com is required.

This installs the runner service, not workflow-specific software such as Docker. Workflows requiring Docker need a separately installed daemon and appropriate runner-user permissions.

Supported secret JSON fields:

- `github_pat`: alias for `github_token`; exchanged for a fresh registration token.

- `github_token`: GitHub access token, exchanged for a fresh runner registration token. A fine-grained PAT needs repository Administration write permission.
- `runner_token`: a fresh registration token from the repository's Actions runner setup page. Registration tokens expire after one hour.
- `password`: existing secret format. Values starting with `ghp_` or `github_pat_` are treated as PATs; other values are treated as registration tokens. This must contain an actual GitHub token, not a generated password.

The AWS secret is not printed or written to a file. The registration token is passed through the runner's supported environment input, not command-line arguments. GitHub stores its own runner credentials after registration. The installer does not update the AWS secret.

Repeat runs preserve the existing registration and ensure its service is started. A directory registered to another repository is rejected. No secret is needed again for an already registered runner. The service runs as the invoking user and survives logout/reboot.

Optional environment variables: `RUNNER_NAME` (default hostname), `RUNNER_DIR` (default `$HOME/actions-runner`). Keep the runner directory at a permanent location. The default directory is outside the checkout, so the checkout need not be writable. Keep custom directories outside the repository.

## Check runner status

Run these commands as the user who installed the runner (the account used for setup). If you used a custom `RUNNER_DIR`, substitute that directory below.

```bash
cd "$HOME/actions-runner"
sudo ./svc.sh status
```

Expected service state: `active (running)`. In [repository Settings → Actions → Runners](https://github.com/mrjithendar/roboshop-ai/settings/actions/runners), check whether the runner is **Idle** (ready), **Active** (executing a job), or **Offline**. A running Linux service alone does not prove that GitHub is connected.

For the exact systemd unit and its boot setting:

```bash
cd "$HOME/actions-runner"
runner_service=$(cat .service)
sudo systemctl status "$runner_service" --no-pager -l
sudo systemctl is-enabled "$runner_service"
```

If `.service` is missing, service installation has not completed. Return to your checkout and rerun `bash runner/setup.sh` after fixing the installation error.

## Logs and service controls

Show recent logs or follow live activity (Ctrl+C stops following):

```bash
cd "$HOME/actions-runner"
runner_service=$(cat .service)
sudo journalctl -u "$runner_service" -n 100 --no-pager -l
sudo journalctl -u "$runner_service" -f
```

Runner diagnostic files are in `$HOME/actions-runner/_diag/`: `Runner_*.log` covers the runner process; `Worker_*.log` covers individual jobs. List recent files, then open the relevant file with `less`:

```bash
ls -lt "$HOME/actions-runner/_diag/"
```

Start or stop the service:

```bash
cd "$HOME/actions-runner"
sudo ./svc.sh start
# Stop only when the runner is idle, to avoid interrupting a job.
sudo ./svc.sh stop
```

To restart an idle runner:

```bash
cd "$HOME/actions-runner"
runner_service=$(cat .service)
sudo systemctl restart "$runner_service"
sudo ./svc.sh status
```

## Basic troubleshooting

| Symptom | Check or fix |
| --- | --- |
| `Permission denied` creating the runner directory | From the checkout, run `RUNNER_DIR="$HOME/actions-runner" bash runner/setup.sh`. Run setup as your runner user, without sudo. |
| Missing `libicu` / .NET dependencies | On Amazon Linux 2023, run the dependency command below, then rerun setup from the checkout. Updated setup installs these automatically. |
| AWS `AccessDenied` or secret not found | Run the AWS checks below as your runner user. Confirm the account, region and secret permission. `sudo aws` can use a different identity. |
| GitHub registration returns 401/403/404 | Check the token's validity, repository access and Administration write permission for a fine-grained PAT. A 404 may indicate missing access to the repository. |
| Registration token expired | Replace the token in the secret with a fresh registration token, or use a PAT so setup can request a fresh one. Then rerun setup. |
| Service running but runner Offline | Inspect the journal and `_diag` logs; check DNS, outbound HTTPS, proxy configuration and system time. |
| Workflow queued while runner Idle | Ensure the job's `runs-on` labels match this runner, and the runner is available to this repository. |
| Docker job fails | Run `docker info` as the runner user and `sudo systemctl status docker --no-pager`. Check daemon availability and the runner user's socket permissions. |
| `.runner` exists but runner was removed in GitHub | Rerunning setup preserves the local registration. Follow GitHub's runner removal/re-registration process; changing the AWS secret alone does not re-register it. |

Amazon Linux 2023 dependency repair:

```bash
sudo dnf install -y libicu openssl-libs krb5-libs zlib libstdc++ libgcc
```

Check AWS identity and secret read access without displaying the token:

```bash
aws sts get-caller-identity
aws secretsmanager get-secret-value   --secret-id roboshop-ai --region us-east-1   --query '{Name:Name,ARN:ARN,VersionId:VersionId}' --output json
```

Setup reads the selected secret and region only during initial registration (defaults: `mrjithendar-github-pat`, `us-east-1`). Your `password` field must contain a GitHub token. An already configured runner uses its saved GitHub credentials; restarting it does not fetch the AWS secret again.

Basic network, clock and disk checks:

```bash
curl -I --connect-timeout 10 https://github.com
curl -I --connect-timeout 10 https://api.github.com
timedatectl status
df -h "$HOME/actions-runner"
```

These HTTP checks cover basic connectivity, not every Actions endpoint. For deeper diagnostics, see [GitHub's runner monitoring and troubleshooting guide](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot).

## Script validation

```bash
bash -n runner/setup.sh
python3 -m unittest discover -s runner -p 'test_*.py' -v
```

Local validation: shell syntax and four registration tests pass. Package installation, runner registration and systemd service startup have not been tested on live distribution instances.

Compatibility is bounded by [GitHub’s supported runner platforms](https://docs.github.com/en/actions/reference/runners/self-hosted-runners). AWS CLI v1 is not accepted by the centralized initializer.

References: [runner release and checksums](https://github.com/actions/runner/releases/tag/v2.337.0), [GitHub registration tokens](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-a-repository).

## Run as root

From your Vultr root shell, after copying the updated runner files:

```bash
cd /root/setup-lab/runner
bash setup.sh
```

Root installs do not require `sudo`. Setup sets `RUNNER_ALLOW_RUNASROOT=1` for GitHub runner configuration, uses `/root/actions-runner` by default, and installs the service with `User=root`. Workflow jobs on this runner therefore execute as root. AWS registration uses root’s AWS profile/environment or the instance role; another user’s AWS profile is not automatically reused.

To specify the repository and AWS secret explicitly:

```bash
bash setup.sh mrjithendar/roboshop-ai roboshop-ai us-east-1
```

Check the service:

```bash
cd /root/actions-runner
./svc.sh status
```

An existing service keeps its current user; this change does not migrate an already registered service from another account. Regular-user installations continue to run under that user with sudo used only for package/service operations.

## GitHub runner-registration returns 404

AWS retrieval succeeding only confirms access to the secret; it does not validate the GitHub token. Verify the repository printed by setup. A registration token must be fresh (expires in one hour) and generated for that exact repository, not an organization or another repository.

In GitHub, open the target repository → Settings → Actions → Runners → New self-hosted runner. Copy its registration token into the AWS secret as `{"runner_token":"YOUR_FRESH_TOKEN"}`, then rerun setup immediately. Alternatively store a personal access token as `github_token`; a fine-grained token must grant the target repository Administration read/write access. Setup exchanges it for a fresh registration token. Do not use the WordPress password or place a PAT under `runner_token`.

Setup now prints the target repository and preserves safe diagnostic messages. It cannot determine the scope or expiry of an opaque registration token locally.

### Existing `mrjithendar-github-pat` secret

If this secret contains `{"github_pat":"YOUR_ACTUAL_PAT"}`, no rename is needed. Use the updated runner files and run:

```bash
bash setup.sh mrjithendar/roboshop-ai mrjithendar-github-pat us-east-1
```

The AWS identity must have GetSecretValue permission for `mrjithendar-github-pat`. The PAT must grant access to the target repository and the required administrator permissions. Change the region argument if the secret lives elsewhere.

## Repair SELinux `203/EXEC` failures

Setup now applies a persistent `bin_t` context to the configured runner tree before starting its service. SELinux remains enabled. Existing rules are updated on reruns, and disabled/non-SELinux hosts skip this step. Only the validated runner directory is relabeled; its registration and credentials are preserved. New archives are extracted without adopting the archive creator’s numeric ownership.

For an existing root installation, copy all updated `runner/` files to your server and run:

```bash
cd /root/setup-lab/runner
bash repair-service.sh /root/actions-runner
```

This installs SELinux management tooling if missing, applies the persistent context, restores executable permission on `runsvc.sh`, and restarts the existing service. It does not fetch an AWS secret or register again. For a different runner directory, pass that directory instead; run the repair script as root or with sudo.

## AWS installed, but `aws configure` is not found in the current shell

Setup now persists private tool PATH in `.tools/env.sh` and adds a managed source
line to your Bash startup files. This also happens before runner registration,
so it remains available if secret retrieval fails. Existing open shells need:

```bash
source "$HOME/actions-runner/.tools/env.sh"
hash -r
aws --version
aws configure
aws sts get-caller-identity
```

If using an older setup that has not generated `env.sh`, use the installed binary
by its full path: `$HOME/actions-runner/.tools/bin/aws configure`. Do not install
the PyPI package named `aws`: it is not AWS CLI v2. Setup does not remove unrelated
Python packages automatically. AWS credentials are never generated by this script.
On Hetzner, configure credentials/profile (or your chosen supported AWS identity
mechanism); an EC2 instance role is not automatically available there.

If STS works but registration fails, verify that the secret exists in the selected
region and your identity can read it. You can test permission without printing its
contents:

```bash
aws secretsmanager get-secret-value --secret-id roboshop-ai --region us-east-1 \
  --query ARN --output text
```

## AWS secret temporarily unavailable

Setup finishes installing tools and runner files even when AWS credentials are
missing, secret permissions are denied, or the secret cannot be retrieved. It
reports **registration pending** and exits successfully without installing or
starting an unregistered runner service. Configure AWS access and rerun the same
setup command to register. A successful setup exit alone does not mean the runner
is online: check the completion message and GitHub's runner status.

Invalid secret contents, rejected GitHub registration and tool installation errors
still fail setup. Existing registered runners do not need the AWS secret again.

### Root shell repair for the unrelated pip `aws` command

Running setup as root now verifies the installed official CLI identifies itself
as AWS CLI v2, backs up any conflicting `/usr/local/bin/aws` command under
`/usr/local/bin/aws-command-backup-*`, then atomically replaces it with a link to
the official runner-managed binary. This repairs the exact command path cached by
the current root shell, so no PATH export or shell restart is required. The Python
package and its dependencies are not uninstalled. The link depends on the runner's
permanent directory; with the default `/root/actions-runner` it is intended for
root's use, not other local users. Non-root setup retains user-local PATH handling.

After the updated setup completes (even with registration pending), run
`aws configure` normally. Credentials still must be supplied by you; setup does
not invent or retrieve AWS credentials from the GitHub registration secret.

### Retrying installation after registration failure

Setup checks OS packages before installing missing ones. It reuses working private
Python/pip and AWS CLI v2, and reuses extracted runner files when their runtime
version check succeeds. Missing or broken tools are repaired. Normal reruns do
not upgrade working tools or clear the Python environment.

A GitHub 404 is an authentication/repository-access failure, not a missing
installation. Update the selected AWS secret with a fresh repository registration
token or an authorized PAT in `github_token`, then rerun:

```bash
bash runner/setup.sh mrjithendar/roboshop-ai mrjithendar-github-pat us-east-1
```

A PAT is exchanged for a fresh registration token on each registration attempt.
Setup cannot refresh an expired raw registration token without an authorized PAT.

## Ten concurrent jobs

A runner process accepts one job at a time. On the existing Linux runner host run:

```bash
bash runner/setup-parallel.sh
```

This reuses `$HOME/actions-runner` as slot 1 and creates slots 2–10 under
`$HOME/actions-runner-2` through `-10`, with separate registration, work directories,
private tools and systemd services. Active existing services are not stopped.
Rerunning resumes incomplete setup. Authenticate with GitHub CLI or supply GH_TOKEN so each slot obtains a fresh
registration token. The optional AWS secret can still supply a PAT; an expired
registration token cannot register additional runners. GitHub App private-key
authentication is not implemented by this installer.

Optional overrides: `RUNNER_COUNT=10`, `RUNNER_DIR=/path/actions-runner`, and
`RUNNER_NAME=build-host`. Positional arguments match `setup.sh`. All slots use the
invoking user's Docker access, AWS configuration and kubeconfig. Existing workflow
`self-hosted` labels can schedule jobs on these runners without YAML duplication.
Verify all ten are Online in GitHub **Settings → Actions → Runners**.

This enables up to ten self-hosted jobs, not ten whole workflows regardless of
job dependencies. Hosted jobs have separate capacity. Deployment and Terraform
concurrency locks remain in place. Image publishing uses a private Docker config
per job so one runner's ECR logout does not erase another runner's credentials.
The runners still share CPU, RAM, disk and the Docker daemon; ten simultaneous
multi-architecture builds can compete with Minikube on the same host. No extra
host resources are provisioned. Lowering the count does not uninstall runners.

## Automatic registration without an AWS secret

The short-lived runner registration token is generated automatically for each new
runner. You must authenticate once as a GitHub account with administrative access
to the repository; GitHub does not issue registration tokens anonymously.

If GitHub CLI is already installed, sign in as the same Linux user running setup:

```bash
gh auth login --hostname github.com --git-protocol https --web
RUNNER_AUTH=github bash runner/setup-parallel.sh
```

Alternatively use a fine-grained PAT restricted to this repository with
**Administration: read and write**, entered privately rather than saved in shell
history (Bash):

```bash
read -rsp 'GitHub PAT: ' GH_TOKEN; echo
export GH_TOKEN
RUNNER_AUTH=github bash runner/setup-parallel.sh
unset GH_TOKEN
```

`RUNNER_AUTH=github` never queries Secrets Manager. Default `auto` tries environment
credentials, then `gh auth token`, then the legacy AWS secret. `RUNNER_AUTH=aws`
explicitly selects that legacy path. Invalid supplied credentials fail clearly;
they are not silently replaced by another identity. A workflow's built-in
GITHUB_TOKEN normally lacks runner administration permission; use an appropriate
PAT or CLI login. Credentials are not logged, and the bootstrap PAT is removed
from the environment passed to runner configuration. Existing registered runners
continue using their own saved credentials and do not need token refresh.

### Use the stored GitHub PAT

The default AWS secret is `mrjithendar-github-pat` in `us-east-1`, with the JSON
field `github_pat`. To explicitly use it rather than a local GitHub CLI login:

```bash
RUNNER_AUTH=aws bash runner/setup-parallel.sh
```

Each unregistered slot reads the PAT privately and exchanges it for a fresh
registration token. The secret is not overwritten with the short-lived token.
Override the secret with the second argument or `RUNNER_SECRET_NAME`.
