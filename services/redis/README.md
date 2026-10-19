# Redis location cache

`compose.yml` owns the Redis deployment and mounts `redis.conf`. The root Compose
file extends it; start with `docker compose up -d redis` from the repository root
with `REDIS_PASSWORD` configured in the ignored `.env`.

Redis caches public country/city lookup responses only. It is not the source of
truth for orders, sessions, addresses, or inventory. The cache uses a 128 MB memory
limit, LRU eviction, and no persistence. Java shipping falls back to PostgreSQL on
cache failures. Redis is reachable within the Compose network and published only
on host loopback port 6379.

Production Helm uses an external Redis service with TLS through
`integrations.secretName`; see `../../infrastructure/helm/README.md`. Provision that
service with your cloud platform or operator rather than treating this single local
container as a highly available deployment. Do not put passwords in `redis.conf`.
