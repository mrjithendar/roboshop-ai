# Service image workflows

Each `ci-<service>.yml` runs on a push to any branch that changes its service directory or its own
workflow file. It runs the service's tests (where it has them) and calls `publish-image.yml` (with
`secrets: inherit`), which always builds the image. Only a push to the default branch logs in to
Harbor and pushes `:latest`; other branches (feature, Dependabot) build without pushing, so they
never replace the image mk4 runs.
The reusable publisher is deliberately excluded from push path filters: adding a
service to its allowlist must not trigger builds of every unrelated service.

When editing the shared publisher, manually run an appropriate service image
workflow from Actions to validate the change. If a shared build change needs all
images rebuilt, manually dispatch each affected workflow. A manual run publishes only when
dispatched on the default branch.

A push that changes several service directories or CI files still triggers all
matching workflows. GitHub evaluates the changed files across the push, not the
commit message. The commit introducing these narrower filters itself changes all
service workflow files and may therefore trigger one final round of builds.

## Deployment configuration

The publisher pushes `registry.jithendar.com/jithendar/roboshop-<service>:latest`, matching the deployment
manifests. It needs the repository secrets `HARBOR_USERNAME` and `HARBOR_PASSWORD` (robot
`robot$jithendar+roboshop-ai`, from the tools repository's `deploy/minikube/harbor/registry.py ci-robots`).
It runs on `ubuntu-latest` and builds `linux/arm64` (the mk4 nodes) under QEMU, so builds are slower than native.

When manually running Deploy-Minikube, select the kubeconfig context with
`profile`. The optional `kubeconfig` input is a file path on the self-hosted
runner. Leave it blank to use the runner's `KUBECONFIG` environment variable,
or `$HOME/.kube/config` when that variable is unset.
