# Service image workflows

Each `ci-<service>.yml` runs on changes to its service directory or its own
workflow file. It calls `publish-image.yml` (with `secrets: inherit`) to build and push that service's
image to Harbor.
The reusable publisher is deliberately excluded from push path filters: adding a
service to its allowlist must not trigger builds of every unrelated service.

When editing the shared publisher, manually run an appropriate service image
workflow from Actions to validate the change. If a shared build change needs all
images rebuilt, manually dispatch each affected workflow. Publication retains the
existing default-branch guard.

A push that changes several service directories or CI files still triggers all
matching workflows. GitHub evaluates the changed files across the push, not the
commit message. The commit introducing these narrower filters itself changes all
service workflow files and may therefore trigger one final round of builds.

## Deployment configuration

The publisher pushes `registry.jithendar.com/jithendar/roboshop-<service>:latest`, matching the deployment
manifests. It needs the repository secrets `HARBOR_USERNAME` and `HARBOR_PASSWORD` (robot
`robot$jithendar+roboshop-ai`, from the tools repository's `deploy/minikube/harbor/registry.py ci-robots`).

When manually running Deploy-Minikube, select the kubeconfig context with
`profile`. The optional `kubeconfig` input is a file path on the self-hosted
runner. Leave it blank to use the runner's `KUBECONFIG` environment variable,
or `$HOME/.kube/config` when that variable is unset.
