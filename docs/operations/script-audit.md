> Deployment-script cleanup: imperative application deployment commands in this
> document are retired. Use the Argo CD catalog and the five supported commands
> documented in `docs/operations/scripts.md`. Historical examples below are not
> runnable deployment instructions. `services/frontend` and `services/nginx` have since
> been consolidated into `services/web` (one `web` image and Deployment).

# Operational script audit

Inventory of current commands and retained service-owned tools. Detailed caller/dependency/variable lists are in `script-audit.json`. Dependencies below are static command references, not proof that all branches execute. No AGENTS.md was found in the repository or parent workspace.

| Old path → canonical path | Purpose | Dependencies | Platform | Side effects |
|---|---|---|---|---|
| `build-push-ecr.sh` → `scripts/images/build-push-ecr.sh` | Container registry operations | bash, docker, minikube, aws | ARM64 Docker engine (existing restriction) | Builds images; authenticated remote registry writes |
| `delete_branch.sh` → `scripts/maintenance/delete-branches.sh` | Maintenance and cleanup | bash, git, gh, jq | CentOS Stream 9/10 | May delete/modify local or remote state; inspect explicit confirmation flags |
| `deploy-minikube.sh` → `scripts/deploy/deploy-minikube.sh` | Deployment | bash, python3, kubectl, minikube, aws | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `evaluations/agents/evaluate.py` | Build and test |  | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `generate-secrets.py` → `scripts/data/generate-secrets.py` | Database/configuration and synthetic data | python3 | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `init.sh` | Host initialization / runner administration | bash, python3, docker, minikube, aws | CentOS Stream 9/10 | Host packages/services or runner registration; init alone never registers |
| `kubectl.sh` → `scripts/dev/kubectl.sh` | Local development / operational helper | bash, kubectl, minikube | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `minikube/connect-langfuse.sh` | Observability / TLS | bash, python3, kubectl, minikube | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/deploy-argocd.sh` | Deployment | bash, kubectl, helm, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/deploy-cert-manager.sh` | Deployment | bash, kubectl, helm, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/deploy-grafana.sh` | Observability / TLS | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/deploy-jfrog.sh` | Deployment | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/deploy-metrics-server.sh` | Observability / TLS | bash, kubectl, helm, minikube | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/deploy-prometheus.sh` | Observability / TLS | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/deploy-traefik.sh` | Deployment | bash, kubectl, helm, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/deploy-wordpress.sh` | Deployment | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/expose-ingress.sh` | Deployment | bash, node, docker, kubectl, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/host-limits.sh` | Local development / operational helper | bash, minikube | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `minikube/install-dependencies.sh` | Host initialization / runner administration | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | Host packages/services or runner registration; init alone never registers |
| `minikube/install.sh` | Host initialization / runner administration | bash, node, jq, docker, kubectl, minikube, systemctl | CentOS Stream 9/10 | Host packages/services or runner registration; init alone never registers |
| `minikube/jfrog/bootstrap.py` | Database/configuration and synthetic data | kubectl | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `minikube/jfrog/preflight.py` | Local development / operational helper | node, kubectl | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `minikube/jfrog/publish-image.sh` | Container registry operations | bash, docker, minikube | CentOS Stream 9/10 | Builds images; authenticated remote registry writes |
| `minikube/kubeconfig.py` | Local development / operational helper | python3, kubectl | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `minikube/kubeconfig.sh` | Local development / operational helper | bash, python3, jq, docker, kubectl, minikube | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `observability/credentials.py` | Database/configuration and synthetic data | kubectl | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `minikube/remove-langfuse.sh` | Maintenance and cleanup | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | May delete/modify local or remote state; inspect explicit confirmation flags |
| `minikube/reset-monitoring.sh` | Maintenance and cleanup | bash, python3, kubectl, helm, minikube | CentOS Stream 9/10 | May delete/modify local or remote state; inspect explicit confirmation flags |
| `minikube/reset.sh` | Maintenance and cleanup | bash, minikube | CentOS Stream 9/10 | May delete/modify local or remote state; inspect explicit confirmation flags |
| `minikube/roboshop/deployment.py` | Deployment | kubectl, minikube | CentOS Stream 9/10 | Changes Kubernetes/host networking; never initialization |
| `minikube/setup-shared-tls.sh` | Observability / TLS | bash, python3, minikube | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/setup.sh` | Host initialization / runner administration | bash, minikube | CentOS Stream 9/10 | Host packages/services or runner registration; init alone never registers |
| `minikube/shared-tls/configure.py` | Observability / TLS | kubectl | CentOS Stream 9/10 | Changes monitoring/TLS resources or credentials |
| `minikube/tunnel-endpoint.sh` | Local development / operational helper | bash, python3, minikube | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `minikube/wordpress/bootstrap.sh` | Database/configuration and synthetic data |  | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `minikube/wordpress/check-routes.py` | Local development / operational helper |  | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `runner/fix-selinux.sh` | Maintenance and cleanup | bash, python3 | CentOS Stream 9/10 systemd (x86_64/ARM64) | May delete/modify local or remote state; inspect explicit confirmation flags |
| `runner/install-tools.sh` | Host initialization / runner administration | bash, aws, pip | CentOS Stream 9/10 systemd (x86_64/ARM64) | Host packages/services or runner registration; init alone never registers |
| `runner/publish_aws.py` | Host initialization / runner administration | python3, aws | CentOS Stream 9/10 systemd (x86_64/ARM64) | Host packages/services or runner registration; init alone never registers |
| `runner/register.py` | Host initialization / runner administration | python3, gh, aws | CentOS Stream 9/10 systemd (x86_64/ARM64) | Host packages/services or runner registration; init alone never registers |
| `runner/repair-service.sh` | Maintenance and cleanup | bash, systemctl | CentOS Stream 9/10 systemd (x86_64/ARM64) | May delete/modify local or remote state; inspect explicit confirmation flags |
| `runner/setup-parallel.sh` | Host initialization / runner administration | bash, python3, systemctl | CentOS Stream 9/10 systemd (x86_64/ARM64) | Host packages/services or runner registration; init alone never registers |
| `runner/setup.sh` | Host initialization / runner administration | bash, python3, git, gh, curl, aws, openssl, systemctl, pip | CentOS Stream 9/10 systemd (x86_64/ARM64) | Host packages/services or runner registration; init alone never registers |
| `scripts/dev.mjs` → `scripts/dev/start.mjs` | Local development / operational helper | python3, node | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `scripts/evaluate.py` → `scripts/test/evaluate.py` | Build and test | python3 | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `scripts/run-python.mjs` → `scripts/lib/run-python.mjs` | Local development / operational helper | python3, node | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `scripts/seed-minikube-demo.py` → `scripts/data/seed-minikube-demo.py` | Database/configuration and synthetic data | python3, kubectl, minikube | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `scripts/setup/initialize.py` | Local development / operational helper | bash, python3, node, npm, git, curl, jq, docker, kubectl, helm, minikube, aws, terraform, openssl, systemctl | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `scripts/squash-history.py` → `scripts/maintenance/squash-history.py` | Maintenance and cleanup | python3, git, gh | CentOS Stream 9/10 | May delete/modify local or remote state; inspect explicit confirmation flags |
| `services/ai-gateway/commerce_migrate.py` | Database/configuration and synthetic data |  | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/bootstrap.mjs` | Database/configuration and synthetic data |  | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/import.mjs` | Database/configuration and synthetic data | node, npm | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/migrate-catalogue.mjs` | Database/configuration and synthetic data | node | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/publish-catalogue.mjs` | Database/configuration and synthetic data |  | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/scripts/export-demo.py` | Database/configuration and synthetic data | python3 | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/catalogue-service/scripts/seed-demo.py` | Database/configuration and synthetic data | python3 | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `services/nginx/start.sh` | Local development / operational helper |  | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `services/postgres/10-shipping-role.sh` | Local development / operational helper | psql | CentOS Stream 9/10 | Local processes/configuration; helper-specific remote reads/writes |
| `services/shipping-service/gradlew` | Build and test | bash | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `services/user-service/bootstrap.py` | Database/configuration and synthetic data |  | CentOS Stream 9/10 | May write database/secrets; explicit operator action |
| `tests/load/identity.py` | Build and test |  | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/install-k6.py` | Host initialization / runner administration | python3, curl, k6 | CentOS Stream 9/10 | Host packages/services or runner registration; init alone never registers |
| `tests/load/lab.py` | Build and test | python3, node, git, k6 | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/load-test.sh` | Build and test | bash | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/load.js` | Build and test | k6 | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/mocks.py` | Build and test |  | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/payment.mjs` | Build and test |  | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/service.py` | Build and test |  | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |
| `tests/load/test_lab.py` | Build and test (retained tests) | k6 | CentOS Stream 9/10 | Mocks/local fixtures |
| `tests/load/test_website.py` | Build and test (retained tests) |  | CentOS Stream 9/10 | Mocks/local fixtures |
| `tests/load/website.py` | Build and test | python3, curl | CentOS Stream 9/10 | Local outputs; load real-ai/live website modes require explicit opt-in |

## package.json commands (retained with owning package)

- `package.json` / `dev`: `node --env-file-if-exists=.env scripts/dev/start.mjs`
- `package.json` / `start`: `node --env-file-if-exists=.env scripts/dev/start.mjs`
- `package.json` / `test`: `node --test tests/*.test.mjs services/*/tests/*.test.mjs`
- `package.json` / `evaluate`: `node scripts/lib/run-python.mjs scripts/test/evaluate.py`
- `package.json` / `ingest`: `node services/catalogue-service/import.mjs`
- `package.json` / `mcp`: `node --env-file-if-exists=.env scripts/lib/run-python.mjs services/mcp-server/server.py`
- `package.json` / `shipping:build`: `sh services/shipping-service/gradlew -p services/shipping-service --no-daemon test bootJar`
- `package.json` / `predev`: `npm run frontend:build && npm run shipping:build`
- `package.json` / `prestart`: `npm run frontend:build && npm run shipping:build`
- `package.json` / `pretest`: `npm run frontend:build && npm run shipping:build && npm run test:python`
- `package.json` / `test:nginx`: `NGINX_TEST=true node --test tests/nginx.test.mjs`
- `package.json` / `frontend:build`: `npm --prefix services/frontend run build`
- `package.json` / `frontend:typecheck`: `npm --prefix services/frontend run typecheck`
- `package.json` / `pretest:nginx`: `npm run frontend:build`
- `package.json` / `admin:bootstrap`: `node --env-file-if-exists=.env scripts/lib/run-python.mjs services/user-service/bootstrap.py`
- `package.json` / `test:python`: `node scripts/lib/run-python.mjs -m unittest discover -s tests/python -v && node scripts/lib/run-python.mjs -m unittest discover -s services/ai-gateway/tests -v && node scripts/lib/run-python.mjs -m unittest discover -s services/user-service/tests -v && node scripts/lib/run-python.mjs -m unittest discover -s services/moks/tests -v`
- `services/catalogue-service/package.json` / `start`: `node server.mjs`
- `services/catalogue-service/package.json` / `test`: `node --test tests/*.test.mjs`
- `services/catalogue-service/package.json` / `ingest`: `node import.mjs`
- `services/catalogue-service/package.json` / `publish:catalogue`: `node publish-catalogue.mjs`
- `services/frontend/package.json` / `build`: `node scripts/build.mjs`
- `services/frontend/package.json` / `typecheck`: `tsc -p tsconfig.json --noEmit`
- `services/frontend/package.json` / `test`: `node --test tests/*.test.mjs`
- `services/frontend/package.json` / `pretest`: `npm run build`
- `services/payment-service/package.json` / `start`: `node server.mjs`
- `services/payment-service/package.json` / `test`: `node --test tests/*.test.mjs`
- `services/sre-copilot/package.json` / `start`: `node server.mjs`

## Workflow shell tasks (retained in isolated CI jobs)

CI setup actions remain job-local. ECR publication and Terraform/deployment jobs are state-changing; PR test jobs are separate. Infrastructure tasks also live in `infrastructure/Jenkinsfile`. No Makefile is tracked.

### .github/workflows/ci-currency-service.yml / test / Ensure C compiler for Go race detector

```bash
set -euo pipefail
if command -v gcc >/dev/null 2>&1; then
  gcc --version
  exit 0
fi
elevate=()
if [[ "$(id -u)" != 0 ]]; then
  sudo -n true
  elevate=(sudo -n)
fi
if command -v dnf >/dev/null 2>&1; then
  "${elevate[@]}" dnf install -y gcc
elif command -v yum >/dev/null 2>&1; then
  "${elevate[@]}" yum install -y gcc
elif command -v apt-get >/dev/null 2>&1; then
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y build-essential
elif command -v zypper >/dev/null 2>&1; then
  "${elevate[@]}" zypper --non-interactive install gcc glibc-devel
else
  echo "No supported package manager found to install GCC." >&2
  exit 1
fi
gcc --version
```

### .github/workflows/ci-currency-service.yml / test / Test with race detector

```bash
go test -race ./...
```

### .github/workflows/ci-kafka-bridge.yml / test / shell task

```bash
docker build --platform linux/arm64 --target test services/kafka-bridge
```

### .github/workflows/ci-user-service.yml / verify / shell task

```bash
python -m pip install -r services/user-service/requirements.txt -r services/user-service/tests/requirements.txt
```

### .github/workflows/ci-user-service.yml / verify / shell task

```bash
python -m unittest discover -s services/user-service/tests -v
```

### .github/workflows/create-infrastructure.yml / terraform / terraform format check

```bash
terraform -chdir=infrastructure fmt -check
```

### .github/workflows/create-infrastructure.yml / terraform / terraform init & validate

```bash
terraform -chdir=infrastructure init -input=false -no-color
terraform -chdir=infrastructure validate -no-color
```

### .github/workflows/create-infrastructure.yml / terraform / terraform plan

```bash
umask 077
terraform -chdir=infrastructure plan -input=false -no-color -lock-timeout=5m \
  -out=tf.tfplan --var-file=vars/terraform.tfvars
```

### .github/workflows/create-infrastructure.yml / terraform / terraform apply

```bash
terraform -chdir=infrastructure apply -input=false -no-color -lock-timeout=5m tf.tfplan
```

### .github/workflows/deploy-minikube.yml / deploy / Check cluster prerequisites

```bash
set -euo pipefail
for tool in kubectl aws python3; do command -v "$tool" >/dev/null; done
export KUBECONFIG="${RUNNER_KUBECONFIG:-${KUBECONFIG:-$HOME/.kube/config}}"
[[ -f "$KUBECONFIG" && "$KUBECONFIG" != *$'\n'* ]] || { echo 'Kubeconfig file is missing or invalid.' >&2; exit 1; }
echo "KUBECONFIG=$KUBECONFIG" >> "$GITHUB_ENV"
kubectl --context="$KUBE_CONTEXT" --request-timeout=15s get namespace kube-system >/dev/null
kubectl --context="$KUBE_CONTEXT" get ingressclass traefik -o name
kubectl --context="$KUBE_CONTEXT" get crd middlewares.traefik.io -o name
kubectl --context="$KUBE_CONTEXT" get clusterissuer letsencrypt-prod -o name
```

### .github/workflows/deploy-minikube.yml / deploy / Initialize application namespace, configuration and credentials

```bash
set -euo pipefail
kubectl --context="$KUBE_CONTEXT" apply -f minikube/roboshop/roboshop-ai-namespace.yaml, minikube/roboshop/roboshop-config-configmap.yaml
# Generate only on a fresh installation; preserve existing credentials.
# Refuse replacement passwords when persistent data already exists.
python3 minikube/roboshop/deployment.py credentials --context="$KUBE_CONTEXT"
```

### .github/workflows/deploy-minikube.yml / deploy / Refresh ECR pull credential

```bash
set -euo pipefail
aws ecr get-authorization-token --registry-ids 881026659929 --query 'authorizationData[0].authorizationToken' --output text |
  python3 -c 'import base64,json,os,sys; token=sys.stdin.read().strip(); assert token and token != "None", "Missing ECR token"; config=json.dumps({"auths":{os.environ["ECR_REGISTRY"]:{"auth":token}}}); print(json.dumps({"apiVersion":"v1","kind":"Secret","metadata":{"name":"ecr-pull","namespace":"roboshop-ai"},"type":"kubernetes.io/dockerconfigjson","data":{".dockerconfigjson":base64.b64encode(config.encode()).decode()}}))' |
  kubectl --context="$KUBE_CONTEXT" apply --server-side --field-manager=roboshop-ecr -f -
```

### .github/workflows/deploy-minikube.yml / deploy / Apply data and messaging services

```bash
# Remove the old controller and wait for its pod to stop before mounting
# the existing Mongo PVC in mongodb-0. Never delete the PVC or Secrets.
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai delete deployment/mongodb --ignore-not-found --cascade=foreground --wait=true --timeout=120s
for service in mongodb postgres redis rabbitmq jaeger otel-collector; do
  kubectl --context="$KUBE_CONTEXT" apply -f "services/$service/$service-minikube.yaml"
done
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy Kafka order-event bridge

```bash
kubectl --context="$KUBE_CONTEXT" apply -f services/kafka-bridge/kafka-service-minikube.yaml, services/kafka-bridge/kafka-statefulset-minikube.yaml, services/kafka-bridge/kafka-internal-network-policy-minikube.yaml
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart statefulset/kafka
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy catalogue-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/catalogue-service/catalogue-service-service-minikube.yaml, services/catalogue-service/catalogue-service-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/catalogue-service
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy moks from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/moks/moks-service-minikube.yaml, services/moks/moks-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/moks
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy sre-copilot from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/sre-copilot/sre-copilot-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/sre-copilot
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy cart-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/cart-service/cart-service-service-minikube.yaml, services/cart-service/cart-service-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/cart-service
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy payment-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/payment-service/payment-service-service-minikube.yaml, services/payment-service/payment-service-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/payment-service
```

### .github/workflows/deploy-minikube.yml / deploy / Import PostgreSQL location database

```bash
# SQL import requires an accepting database on first installation.
# This is a bounded dependency check, not a rollout-status gate.
database_ready=false
for attempt in {1..60}; do
  if kubectl --context="$KUBE_CONTEXT" --request-timeout=10s -n roboshop-ai exec deployment/shipping-db --               sh -c 'pg_isready --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"'; then
    database_ready=true
    break
  fi
  sleep 5
done
[[ "$database_ready" == true ]] || { echo 'PostgreSQL is not accepting connections; rerun after resolving database startup.' >&2; exit 1; }
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai exec -i deployment/shipping-db -- \
  sh -c 'exec psql -X --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  < services/postgres/shipping.sql
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy shipping-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/shipping-service/shipping-service-service-minikube.yaml, services/shipping-service/shipping-service-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/shipping-service
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy user-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/user-service/user-service-service-minikube.yaml, services/user-service/user-service-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/user-service
```

### .github/workflows/deploy-minikube.yml / deploy / Remove retired SMTP workload

```bash
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai delete deployment/smtp-server service/smtp-server networkpolicy/smtp-gateway-only --ignore-not-found
# Preserve the old queue PVC and keys; removal does not discard queued mail.
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy ai-gateway from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/ai-gateway/gateway-data-pvc-minikube.yaml, services/ai-gateway/ai-gateway-service-minikube.yaml, services/ai-gateway/ai-gateway-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/ai-gateway
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy optional currency-service from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f services/currency-service/currency-service-service-minikube.yaml, services/currency-service/currency-service-deployment-minikube.yaml
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/currency-service
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy frontend from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/frontend/frontend-service-minikube.yaml, services/frontend/frontend-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/frontend
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy nginx from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/nginx/nginx-service-minikube.yaml, services/nginx/nginx-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/nginx
```

### .github/workflows/deploy-minikube.yml / deploy / Deploy mcp-server from ECR

```bash
kubectl --context="$KUBE_CONTEXT" apply -f "services/mcp-server/mcp-server-service-minikube.yaml, services/mcp-server/mcp-server-deployment-minikube.yaml"
kubectl --context="$KUBE_CONTEXT" -n roboshop-ai rollout restart deployment/mcp-server
```

### .github/workflows/deploy-minikube.yml / deploy / Apply ingress and TLS configuration

```bash
KUBE_CONTEXT="$KUBE_CONTEXT" bash minikube/setup-shared-tls.sh
kubectl --context="$KUBE_CONTEXT" apply -f minikube/roboshop/roboshop-prefix-middleware.yaml, minikube/roboshop/roboshop-https-middleware.yaml, minikube/roboshop/roboshop-ingress.yaml, minikube/roboshop/roboshop-http-ingress.yaml
```

### .github/workflows/deploy-minikube.yml / deploy / Record deployment

```bash
{
  echo '### ECR deployment commands submitted'
  echo "Deployment configuration commit: $GITHUB_SHA"
  echo "Kubernetes context: $KUBE_CONTEXT"
  echo 'Images: :latest from each service ECR repository'
  echo 'Application: https://jithendar.com/roboshop/'
  echo 'Manifests applied and application restarts requested; workload and TLS readiness are not checked.'
  echo 'Catalogue publication runs during catalogue-service startup; completion is not checked by this workflow.'
} >> "$GITHUB_STEP_SUMMARY"
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
python -m pip install -r services/user-service/requirements.txt -r services/ai-gateway/requirements.txt -r services/moks/requirements.txt -r tests/python/requirements.txt
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
python -m unittest discover -s tests/python -v
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
python -m unittest discover -s services/ai-gateway/tests -v
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
python -m unittest discover -s services/user-service/tests -v
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
python scripts/test/evaluate.py
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
npm ci
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
npm run frontend:build
```

### .github/workflows/llm-checks.yml / mocked-providers / shell task

```bash
node --test services/frontend/tests/admin-ui.test.mjs services/frontend/tests/frontend.test.mjs
```

### .github/workflows/load-smoke.yml / smoke / Install isolated test dependencies and pinned k6

```bash
python -m venv tests/load/.venv
tests/load/.venv/bin/pip install -r tests/load/requirements.txt
tests/load/.venv/bin/python tests/load/install-k6.py
```

### .github/workflows/load-smoke.yml / smoke / Test guards and mock protocols

```bash
tests/load/.venv/bin/python -m unittest discover -s tests/load -p 'test_*.py'
```

### .github/workflows/load-smoke.yml / smoke / Small mocked journeys (no cloud credentials)

```bash
set -euo pipefail
for scenario in browse session cart idempotency chat isolation limited-stock; do
  tests/load/.venv/bin/python tests/load/lab.py run --run-id "load-ci-${scenario}" --scenario "$scenario" --seconds 2 --vus 1 --k6 tests/load/.tools/k6
done
```

### .github/workflows/load-smoke.yml / smoke / Remove test sessions and private logs

```bash
for fixture in tests/load/.runs/*/fixtures.json; do
  [ -f "$fixture" ] || continue
  run_id=$(basename "$(dirname "$fixture")")
  tests/load/.venv/bin/python tests/load/lab.py cleanup --run-id "$run_id"
done
```

### .github/workflows/publish-ecr.yml / publish / Validate configuration and name image

```bash
set -euo pipefail
case "$(docker info --format '{{.Architecture}}')" in
  arm64|aarch64) ;;
  *) echo 'ARM64 Docker engine required.' >&2; exit 1 ;;
esac
case "$SERVICE" in
  user-service|cart-service|ai-gateway|catalogue-service|moks|sre-copilot|payment-service|mcp-server|shipping-service|frontend|nginx|currency-service|kafka-bridge) ;;
  *) echo 'Unsupported service' >&2; exit 1 ;;
esac
[[ "$REPOSITORY_PREFIX" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*$ ]] || { echo 'Invalid ECR_REPOSITORY_PREFIX' >&2; exit 1; }
suffix="$SERVICE"
[[ "$SERVICE" != shipping-service ]] || suffix=shipping
echo "repository=$REPOSITORY_PREFIX-$suffix" >> "$GITHUB_OUTPUT"
echo "tag=latest" >> "$GITHUB_OUTPUT"
test -f "services/$SERVICE/Dockerfile"
```

### .github/workflows/publish-ecr.yml / publish / Verify Node HTTP logging before publishing

```bash
set -euo pipefail
if [[ -f "services/$SERVICE/lib/runtime.mjs" ]]; then
  docker run --platform linux/arm64 --rm -v "$PWD:/workspace:ro" -w /workspace node:26-alpine \
    node --test tests/http-logging.test.mjs
fi
```

### .github/workflows/publish-ecr.yml / publish / Isolate Docker configuration for this job

```bash
set -euo pipefail
config_dir=$(mktemp -d "$RUNNER_TEMP/docker-config.XXXXXX")
echo "DOCKER_CONFIG=$config_dir" >> "$GITHUB_ENV"
```

### .github/workflows/publish-ecr.yml / publish / Record published image

```bash
printf '### %s\n\nImage: `%s:%s`\n\nDigest: `%s@%s`\n' "$SERVICE" "$IMAGE" "$TAG" "$IMAGE" "$DIGEST" >> "$GITHUB_STEP_SUMMARY"
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python -m pip install -r services/user-service/requirements.txt -r services/ai-gateway/requirements.txt -r services/moks/requirements.txt -r tests/python/requirements.txt
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python -m unittest discover -s tests/python -v
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python -m unittest discover -s services/ai-gateway/tests -v
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python -m unittest discover -s services/user-service/tests -v
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python -m unittest discover -s services/moks/tests -v
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
node --check services/moks/widget.js
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
python scripts/test/evaluate.py
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
npm ci --ignore-scripts
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
npm run frontend:build
```

### .github/workflows/showcase-checks.yml / verify / shell task

```bash
node --test tests/showcase-ui.test.mjs services/frontend/tests/frontend.test.mjs services/frontend/tests/admin-ui.test.mjs tests/catalogue.test.mjs tests/auth.test.mjs services/moks/tests/widget.test.mjs
```

## Ownership decisions

- `services/*` runtime entry points, libraries and tests stay service-local. Dockerfiles copy those independent contexts; no runtime files moved.
- Minikube commands remain adjacent to their manifest/chart/helper/test bundles. Runner scripts remain together because they coordinate service registration and private paths. Both are indexed above.
- `tests/load/` stays a self-contained harness with Docker context and fixtures. k6 checksum installer remains test-local.
- Gradle wrapper stays with shipping. No Compose configuration exists, so Compose is not an init dependency.
- Command notebooks are now Markdown; their old entry points refuse execution.
- Historical `runner/publish_aws.py` remains an explicit maintenance utility/test target; normal runner setup no longer calls it or replaces system AWS.
- `scripts/path-mapping.json` records compatibility mappings. No second implementation is maintained at old paths.

## Dockerfile runtime ownership

These container commands stay service-local; host initialization does not install their application dependencies.

- `services/ai-gateway/Dockerfile`: `FROM python:3.14-slim`; `CMD ["python", "services/ai-gateway/server.py"]`
- `services/cart-service/Dockerfile`: `FROM python:3.14-slim`; `CMD ["python", "services/cart-service/server.py"]`
- `services/catalogue-service/Dockerfile`: `FROM node:26-alpine`; `CMD ["node", "services/catalogue-service/server.mjs"]`
- `services/currency-service/Dockerfile`: `FROM golang:1.27-alpine AS build`; `FROM alpine:3.23`; `ENTRYPOINT ["/usr/local/bin/currency-service"]`
- `services/frontend/Dockerfile`: `FROM node:26-alpine AS frontend-build`; `FROM nginx:1.28-alpine`; `ENTRYPOINT ["nginx", "-g", "daemon off;"]`
- `services/kafka-bridge/Dockerfile`: `FROM python:3.13-slim AS base`; `FROM base AS test`; `FROM base AS runtime`; `CMD ["python", "bridge.py"]`
- `services/mcp-server/Dockerfile`: `FROM python:3.14-slim`; `CMD ["python", "services/mcp-server/server.py"]`
- `services/moks/Dockerfile`: `FROM python:3.14-slim`; `CMD ["python", "services/moks/server.py"]`
- `services/nginx/Dockerfile`: `FROM nginx:1.31-alpine`; `ENTRYPOINT ["/bin/sh", "/etc/nginx/roboshop/start.sh"]`
- `services/payment-service/Dockerfile`: `FROM node:26-alpine`; `CMD ["node", "services/payment-service/server.mjs"]`
- `services/shipping-service/Dockerfile`: `FROM eclipse-temurin:25-jdk AS build`; `FROM eclipse-temurin:25-jre-alpine`; `ENTRYPOINT ["java", "-jar", "/app/shipping-service.jar"]`
- `services/sre-copilot/Dockerfile`: `FROM node:26-alpine`; `CMD ["node", "services/sre-copilot/server.mjs"]`
- `services/user-service/Dockerfile`: `FROM python:3.14-slim`; `CMD ["python", "services/user-service/server.py"]`
