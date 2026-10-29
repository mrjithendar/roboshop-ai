# RabbitMQ order messaging

`rabbitmq-minikube.yaml` deploys the broker as a StatefulSet with the `rabbitmq-data` PVC and a stable node identity. Credentials come from `roboshop-secrets`.

Deploy the whole application from the repository root:

```bash
bash build-images.sh
bash scripts/deploy/deploy-minikube.sh
```

Paid-order events are consumed by shipping to create shipment requests. Preserve the PVC and credentials across deployments. For a private management session use `kubectl -n roboshop-ai port-forward service/rabbitmq 15672:15672`, then open localhost:15672. Do not publish the management UI directly.

See the [Minikube deployment guide](https://github.com/mrjithendar/tools/blob/master/roboshop/minikube/roboshop/README.md) for secret initialization, dependency ordering and troubleshooting. Production database availability, backups and TLS require separate platform configuration.
