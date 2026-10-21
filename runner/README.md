# GitHub Actions runner

Run from the checkout as root or your regular Linux user (for example `ec2-user` or `ubuntu`):

```bash
bash runner/setup.sh mrjithendar/roboshop-ai roboshop-ai us-east-1
```

This is the single deployment entry point; keep the entire `runner/` directory together. With no arguments, the same repository, secret and region are used.

| Argument | Purpose |
| --- | --- |
| `mrjithendar/roboshop-ai` | GitHub repository in OWNER/REPOSITORY format |
| `roboshop-ai` | AWS Secrets Manager secret holding a GitHub token |
| `us-east-1` | AWS region containing that secret |

Setup detects apt, dnf/yum or zypper and installs bootstrap Python, download
utilities, unzip, Git and runner dependencies. `install-tools.sh` then installs
fresh uv, the latest stable CPython available in uv's managed distribution catalogue,
latest pip, and the latest official AWS CLI v2 Linux bundle (x86_64 or ARM64).
These private tools live under `$RUNNER_DIR/.tools`; OS Python and existing global
AWS installations remain untouched. Managed Python uses Astral python-build-standalone
binaries, not your distribution's Python packages. The runner's `.path` file ensures
workflow steps can use `python`, `python3`, `pip`, `pip3` and `aws` after startup.
AWS credentials/profile still belong to the invoking user; no credentials are created.

For an existing runner, wait until GitHub shows **Idle**, then stop its service
before updating tools:

```bash
cd "$HOME/actions-runner"
sudo ./svc.sh stop
cd /path/to/roboshop-ai
bash runner/setup.sh mrjithendar/roboshop-ai roboshop-ai us-east-1
```

Setup refuses to update tools while that service is active. It restarts the service
after successful setup. Reruns refresh the private Python tooling environment;
install project dependencies in project virtual environments or workflow steps.
They preserve runner registration and do not fetch a new GitHub secret for an
already registered runner. If tool installation or registration configuration fails, the service remains stopped until fixed.

Targets are modern Ubuntu/Debian, CentOS Stream/RHEL/Rocky/AlmaLinux/Fedora/Amazon Linux and openSUSE/SLES systems with matching package repositories. Requires **systemd, Python 3.9+, x86_64 or arm64**, and either root or a regular user with sudo access. Python is installed automatically, but an old release whose repositories provide only an older Python must be upgraded. Alpine/musl, OpenRC-only hosts, end-of-life releases and arbitrary Linux distributions are not guaranteed compatible. zypper package availability varies by SUSE release. Setup checks the runner runtime before fetching registration credentials.

The installer downloads runner 2.337.0 and verifies its pinned SHA-256 checksum. Initial registration fetches the specified AWS secret. The AWS identity needs `secretsmanager:GetSecretValue` (plus KMS decrypt permission for a customer-managed key). Provide an EC2 instance role or configure AWS credentials/profile for your user before running. The installer does not create GitHub access tokens or AWS credentials. Outbound HTTPS to package repositories, GitHub, AWS and PyPI, astral.sh, python-build-standalone release downloads and awscli.amazonaws.com is required.

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

Setup reads the selected secret and region only during initial registration (defaults: `roboshop-ai`, `us-east-1`). Your `password` field must contain a GitHub token. An already configured runner uses its saved GitHub credentials; restarting it does not fetch the AWS secret again.

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

Compatibility is bounded by [GitHub’s supported runner platforms](https://docs.github.com/en/actions/reference/runners/self-hosted-runners). The fallback CLI uses [AWS’s virtual-environment installation approach](https://docs.aws.amazon.com/cli/v1/userguide/install-virtualenv.html).

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
