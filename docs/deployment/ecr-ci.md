# Per-service ECR publishing

Each `ci-<service>.yml` in `.github/workflows/` calls `publish-ecr.yml`.
Pushes to the default branch (`master` or `main`) build services whose sources
changed. Shared Python/Node changes rebuild their dependent services. Changes
to the reusable workflow or `.dockerignore` rebuild all ten images. Run a
workflow manually from GitHub Actions on the default branch to publish it without
a source change. Other branches and pull requests cannot publish through these
workflows. If the default branch has another name, update the branch filters.

All builds use the repository root as context and the individual service's
Dockerfile, on GitHub-hosted Ubuntu runners, targeting `linux/amd64`.
These workflows build and publish; they do not deploy or replace application tests.

## GitHub repository variables

Set these under Settings → Secrets and variables → Actions → Variables:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | Region containing the ECR repositories, e.g. `ap-south-1` |
| `AWS_ROLE_ARN` | ARN of the IAM role assumed by GitHub Actions |
| `ECR_REPOSITORY_PREFIX` | Optional repository prefix, default `robotshop`; exclude registry hostname |

No AWS access-key secrets are needed. Configure the AWS account's GitHub OIDC
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

The root `build-images.sh` still builds local images. Compose uses a fixed `local` tag, whereas these pipelines
version services independently. To run their images in Compose, use an override
file setting each service's `image` to its published URI/digest (including the
`nginx` service and optional `mcp-server`). Do not set one workflow's run tag as
the global Compose tag: other images will have different run IDs.

No AWS resources, repository variables, or images are created by adding these
files locally. The first real build/push happens after AWS setup and a matching
GitHub Actions trigger.
