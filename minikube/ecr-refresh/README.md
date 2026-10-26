# Scheduled ECR refresh

Enable from the repository root with authenticated local AWS CLI:

```bash
./bootstrap-cluster.sh --pull-secrets-only --schedule-pull-secrets
```

This seeds `ecr-pull` in the managed namespaces, then installs a CronJob in
`roboshop-ai` running at 00:00, 06:00, 12:00 and 18:00 UTC. ECR tokens last
12 hours. Existing namespaces/default ServiceAccounts are prepared by bootstrap.
The CronJob cannot create/delete secrets or read unrelated secrets: its Roles
allow only GET/PATCH on `ecr-pull`. Updates preserve other registry entries and
use resourceVersion to reject concurrent modifications. Failed Jobs retry twice.

## AWS credentials required inside Minikube

The CronJob does NOT inherit your laptop's AWS login. Put AWS_ACCESS_KEY_ID and
AWS_SECRET_ACCESS_KEY in the existing `roboshop-ai/roboshop-secrets` Secret;
AWS_SESSION_TOKEN is optional for temporary credentials. Use a dedicated IAM
principal with `ecr:GetAuthorizationToken` on `*` and repository-scoped
`ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability`.
Never commit credentials. Existing app passwords must be preserved. This job
renews ECR tokens, not the underlying AWS credentials: expired STS/session keys
must be renewed separately. On EKS, prefer workload IAM over these Minikube keys.

Public AWS CLI and Python images avoid a dependency on the expired ECR token.
Only the AWS init container receives AWS credentials; only the Python container
mounts the projected Kubernetes token. Tokens pass through a memory-backed
volume; API responses/secret values are never logged. No runtime pip install.

Test an immediate run after adding AWS credentials:

```bash
kubectl --context=mk4 -n roboshop-ai create job --from=cronjob/ecr-refresh ecr-refresh-check
kubectl --context=mk4 -n roboshop-ai wait --for=condition=Complete job/ecr-refresh-check --timeout=300s
kubectl --context=mk4 -n roboshop-ai logs job/ecr-refresh-check -c refresh
```

Use another job name for later tests. Missing credentials produce a pod
configuration error; AWS access failures stop the init container without
changing tokens. Missing pull Secrets are reported, not recreated by the job;
rerun bootstrap to restore them. Partial namespace failures leave other successful
updates in place and fail the Job visibly. Monitor failed Jobs; no external
alerting is configured.

Suspend without deleting credentials:

```bash
kubectl --context=mk4 -n roboshop-ai patch cronjob ecr-refresh --type=merge -p '{"spec":{"suspend":true}}'
```

Manual mode remains `./bootstrap-cluster.sh --pull-secrets-only`.
