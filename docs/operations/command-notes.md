> Deployment-script cleanup: imperative application deployment commands in this
> document are retired. Use the Argo CD catalog and the five supported commands
> documented in `docs/operations/scripts.md`. Historical examples below are not
> runnable deployment instructions.

# Historical command examples

Review each command before use. This is not an executable workflow.

```bash
python3 scripts/data/generate-secrets.py # creates secret and creates .env file

minikube start -p mk4 --driver=docker --force

docker run --rm --volumes-from roboshop-ai-shipping-db-1:ro --entrypoint sh postgres:18-alpine \
  -c 'ls -la /var/lib/postgresql/data; find /var/lib/postgresql -name PG_VERSION -type f -print -exec cat {} \;'

PUBLIC_HOST=jithendar.com PROFILE=mk4 NODES=4 CPUS=2 MEMORY=2048 bash minikube/setup.sh
VULTR_HOST=root@jithendar.com API_HOST=jithendar.com PROFILE=mk4 bash minikube/kubeconfig.sh

bash runner/setup-parallel.sh mrjithendar/roboshop-ai mrjithendar-github-pat us-east-1

langfuse: LANGFUSE_BASE_URL=https://us.cloud.langfuse.com bash minikube/connect-langfuse.sh

#VPC
terraform -chdir=infrastructure fmt -check
terraform -chdir=infrastructure init -input=false -no-color
terraform -chdir=infrastructure validate -no-color
terraform -chdir=infrastructure plan -input=false -no-color -lock-timeout=5m \
            -out=tf.tfplan --var-file=vars/terraform.tfvars
terraform -chdir=infrastructure apply -input=false -no-color -lock-timeout=5m tf.tfplan
```
