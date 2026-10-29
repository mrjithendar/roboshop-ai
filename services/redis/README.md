# Redis cache and carts

`redis-minikube.yaml` deploys Redis using a ConfigMap and `REDIS_PASSWORD` from `roboshop-secrets`.

Deploy the whole application from the repository root:

```bash
bash build-images.sh
bash scripts/deploy/deploy-minikube.sh
```

Redis stores cached shipping locations and cart-service state. This sandbox has no Redis PVC; restarts can discard cached state. The gateway keeps its durable order ledger separately. Do not use a cache restart as a cart or order reset mechanism. Keep Redis private to the cluster.

See the [Minikube deployment guide](https://github.com/mrjithendar/tools/blob/master/roboshop/minikube/roboshop/README.md) for secret initialization, dependency ordering and troubleshooting. Production database availability, backups and TLS require separate platform configuration.
