# PostgreSQL shipping database

`postgres-minikube.yaml` deploys `shipping-db` with the `shipping-postgres` PVC. Credentials come from `roboshop-secrets`: `SHIPPING_DB_PASSWORD` for migrations and `SHIPPING_APP_PASSWORD` for the restricted runtime role.

Deploy the whole application from the repository root:

```bash
bash build-images.sh
bash scripts/deploy/deploy-minikube.sh
```

`10-shipping-role.sh` runs only on a new database. Shipping applies its own schema migrations and worldwide location seed before serving HTTP. Runtime access includes location reads and shipment-request writes. Changing a Secret does not rotate an existing database password; coordinate role and Secret changes without deleting the PVC.

See the [Minikube deployment guide](../../minikube/roboshop/README.md) for secret initialization, dependency ordering and troubleshooting. Production database availability, backups and TLS require separate platform configuration.
