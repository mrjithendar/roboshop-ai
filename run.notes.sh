python3 generate-secrets.py # creates secret and creates .env file

docker run --rm \
  --volumes-from roboshop-ai-shipping-db-1:ro \
  --entrypoint sh postgres:18-alpine \
  -c 'ls -la /var/lib/postgresql/data; find /var/lib/postgresql -name PG_VERSION -type f -print -exec cat {} \;'


#VPC
cd vpc
terraform init
terraform plan -var-file=vars/dev.tfvars -out=plan.tfplan