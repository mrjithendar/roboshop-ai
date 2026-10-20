# Per-service ECR publishing

Each `ci-<service>.yml` in `.github/workflows/` calls `publish-ecr.yml`.
Pushes to the default branch (`master` or `main`) build services whose sources
changed. Changes to the reusable publisher rebuild all 15 images. The payment
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
| `ECR_REPOSITORY_PREFIX` | Optional repository prefix, default `robotshop`; exclude registry hostname |

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
CI. Enable immutable tags and scan-on-push according to your account policy.
The workflow checks that its repository exists; it does not provision AWS resources.

| Service workflow | Default ECR repository |
| --- | --- |
| ai-gateway | robotshop-ai-gateway |
| user-service | robotshop-user-service |
| cart-service | robotshop-cart-service |
| catalogue-service | robotshop-catalogue-service |
| finder | robotshop-finder |
| smtp-server | robotshop-smtp-server |
| product-ingestion | robotshop-product-ingestion |
| recommendation-service | robotshop-recommendation-service |
| shopping-agent | robotshop-shopping-agent |
| sre-copilot | robotshop-sre-copilot |
| payment-service | robotshop-payment-service |
| mcp-server | robotshop-mcp-server |
| shipping-service | robotshop-shipping |
| nginx | robotshop-nginx |
| frontend | robotshop-frontend |

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
      "Resource": "arn:aws:ecr:REGION:ACCOUNT_ID:repository/robotshop-*"
    }
  ]
}
```

## Tags and deployment

Tags are `sha-<full-commit-sha>-<workflow-run-id>-<attempt>` so reruns also work
with immutable ECR repositories. No mutable `latest` tag is written. Each run's
summary contains the exact image URI and digest. Use that digest when updating
a service deployment. Run each service workflow manually for an initial complete
set of images.

No AWS resources, repository variables, or images are created by adding these
files locally. The first real build/push happens after AWS setup and a matching
GitHub Actions trigger.

## Deploy the newest ECR images to Minikube

Run **Actions → Deploy-Minikube → Run workflow** after the service CI builds finish.
All deployment logic is in `.github/workflows/deploy-minikube.yml`; no extra shell
or Python deployment helper is required. Service Kubernetes YAML files remain in
their respective folders.

The workflow selects the most recently pushed `sha-*` image in each of the 15
repositories, including SMTP, and pins each service to its digest. Untagged
BuildKit attestations are excluded. All versions are resolved before changing the
cluster; an empty or missing repository fails the run. The summary records the
selected digests. “Newest” is per service and may represent different commits;
wait for all intended CI jobs before deployment.

The workflow initializes or reuses application credentials, deploys infrastructure,
refreshes the ECR pull secret, configures SMTP, and deploys applications in order.
It finishes with catalogue publication and ingress/TLS. Existing database passwords,
DKIM keys and MFA encryption keys are preserved. No images are built or loaded locally.

The runner needs AWS CLI, kubectl, Python/PyYAML and OpenSSL. Set `AWS_REGION` and
optionally `AWS_ROLE_ARN` and `ECR_REPOSITORY_PREFIX`, as for publishing. Its AWS
identity additionally needs `ecr:DescribeImages`. The workflow refreshes the
`robotshop-ai/ecr-pull` secret and references it in application pods. Upstream
infrastructure images remain unchanged.

ECR credentials expire after 12 hours. Cached digest images continue working,
but a new node or uncached image needs a fresh credential. Rerun the workflow to
refresh it. No automatic credential-renewal controller is installed.
