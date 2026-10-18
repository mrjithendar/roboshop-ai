python3 generate-secrets.py # creates secret and creates .env file
docker compose config --quiet
docker compose up -d
docker compose ps

docker run --rm \
  --volumes-from robotshop-ai-shipping-db-1:ro \
  --entrypoint sh postgres:18-alpine \
  -c 'ls -la /var/lib/postgresql/data; find /var/lib/postgresql -name PG_VERSION -type f -print -exec cat {} \;'

