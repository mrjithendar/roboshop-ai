> Deployment-script cleanup: imperative application deployment commands in this
> document are retired. Use the Argo CD catalog and the five supported commands
> documented in `docs/operations/scripts.md`. Historical examples below are not
> runnable deployment instructions.

# Per-service ECR publishing

Each `ci-<service>.yml` in `.github/workflows/` calls `publish-ecr.yml`.
Pushes to the default branch (`master` or `main`) build services whose sources
changed. Changes to the reusable publisher rebuild all 14 images. The payment
workflow currently runs on every default-branch push. Run a
workflow manually from GitHub Actions on the default branch to publish it without
a source change. Other branches and pull requests cannot publish through these
workflows. If the default branch has another name, update the branch filters.

All builds use the individual service directory as context and its own
Dockerfile, on the self-hosted runner, targeting `linux/amd64`.
These workflows build and publish; they do not deploy or replace application tests.

## GitHub repository variables

Set these under Settings → Secrets and variables → Actions → Variables:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | Optional; defaults to `us-east-1`, matching Terraform |
| `AWS_ROLE_ARN` | Optional OIDC role for deployment; publishing uses runner credentials |
| `ECR_REPOSITORY_PREFIX` | Optional repository prefix, default `roboshop`; exclude registry hostname |

Publishing uses the self-hosted runner's AWS credentials (for example, its EC2
instance role or configured AWS credentials). The ECR login action authenticates
Docker automatically. No region variable is required for `us-east-1`. The runner
needs Docker/Buildx and ECR permissions listed below.

The deployment workflow additionally supports an optional `AWS_ROLE_ARN` for OIDC.

For OIDC, configure the AWS account's GitHub OIDC
provider with URL `https://token.actions.githubusercontent.com` and audience
`sts.amazonaws.com`.

The role trust policy must allow `sts:AssumeRoleWithWebIdentity` for that provider,
with `StringEquals` conditions for audience and the **exact default-branch subject**.
For repositories using the legacy subject format:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:OWNER/REPOSITORY:ref:refs/heads/master"
    }}
  }]
}
```

Replace placeholders and branch before applying. New repositories created from
15 July 2026 (and repositories that opted in) use immutable IDs in the subject:
`repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:ref:refs/heads/master`.
Match your repository's configured subject; custom OIDC subjects also need an
exact matching policy. These workflows do not use GitHub environments.
See the [AWS action OIDC documentation](https://github.com/aws-actions/configure-aws-credentials#oidc)
and [GitHub immutable subject announcement](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).

## ECR repositories and role permissions

Create these private repositories in the selected account/region before running
CI. Tags must be mutable so CI can replace `latest`; Terraform configures this.
The workflow checks that its repository exists; it does not provision AWS resources.

| Service workflow | Default ECR repository |
| --- | --- |
| ai-gateway | roboshop-ai-gateway |
| user-service | roboshop-user-service |
| cart-service | roboshop-cart-service |
| catalogue-service | roboshop-catalogue-service |
| moks | roboshop-moks |
| payment-service | roboshop-payment-service |
| mcp-server | roboshop-mcp-server |
| shipping-service | roboshop-shipping |
| nginx | roboshop-nginx |
| frontend | roboshop-frontend |

The frontend image packages the TypeScript storefront and legacy product images.
Nginx is a separate reverse-proxy image. Redis,
RabbitMQ, MongoDB, PostgreSQL and observability components use upstream images;
they have no custom Dockerfiles to publish.

Example role permissions (replace ACCOUNT_ID, REGION and prefix):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:REGION:ACCOUNT_ID:repository/roboshop-*"
    }
  ]
}
```

## Tags and deployment

Every service CI builds and pushes `:latest` to its own ECR repository. Each run's
summary includes the image URI and pushed digest. Run **Create infrastructure** once
to apply the mutable-tag setting, then run all service CI workflows to publish
`latest`, then run **Deploy-Minikube**. Complete CI builds before deployment.

No AWS resources, repository variables, or images are created by adding these
files locally. The first real build/push happens after AWS setup and a matching
GitHub Actions trigger.

## Deploy the newest ECR images to Minikube

Run **Actions → Deploy-Minikube → Run workflow** after the service CI builds finish.
All deployment logic is in `.github/workflows/deploy-minikube.yml`; no extra shell
or Python deployment helper is required. Service Kubernetes YAML files remain in
their respective folders. Application manifests directly reference
`881026659929.dkr.ecr.us-east-1.amazonaws.com/roboshop-<service>:latest`
(`roboshop-shipping` for shipping), with `Always` pull policy and `ecr-pull`.
The workflow creates/refreshes that secret before deploying applications.

The workflow uses `:latest` for all 14 application services. Checked-in manifests
use `imagePullPolicy: Always`; each deployment is restarted to pick up new images
even though the tag is unchanged. The summary records the registry tag and configuration commit. Avoid publishing
while a deployment is in progress, since `latest` can change during the rollout.

This is an update workflow for an existing cluster. It checks the namespace,
application secrets, ConfigMap, Traefik and issuer, refreshes `ecr-pull`, then
applies the checked-in service manifests in dependency order. It finishes with
catalogue publication and ingress/TLS configuration. It does not wait for rollout
status or certificate readiness, or fetch final pod status. Success means the commands
completed; Kubernetes continues starting workloads asynchronously. The existing SQL
import and catalogue publication commands require running database and ingestion pods;
if those are unavailable, fix the underlying issue and rerun. It does not bootstrap
databases or generate application credentials. User-service sends email directly through SES. After requesting its
restart, the workflow removes the retired SMTP Deployment, Service and NetworkPolicy,
while preserving the queue PVC and keys.

The runner needs AWS CLI, kubectl and Python. It uses the runner's AWS credentials
and the existing registry `881026659929.dkr.ecr.us-east-1.amazonaws.com`. Select the
actual kubeconfig context in the `profile` input. Set `MINIKUBE_KUBECONFIG` only if
the runner's kubeconfig is not at its normal location. Its AWS identity needs
`ecr:GetAuthorizationToken` and access to pull the repository images.

ECR credentials expire after 12 hours. Running containers continue working, but
a subsequent pod start with `Always` pull policy needs a valid credential. Rerun
the workflow to refresh it. No automatic credential-renewal controller is installed.
