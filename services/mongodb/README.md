# MongoDB accounts and catalogue

`mongodb-minikube.yaml` deploys MongoDB with the `mongodb-data` PVC. `roboshop-secrets` supplies `MONGO_ROOT_PASSWORD` and `MONGO_APP_PASSWORD`.

Deploy the whole application from the repository root:

```bash
bash build-images.sh
bash deploy-minikube.sh
```

`10-app-user.js` initializes the application account only on a new database. Accounts, sessions, products and settings persist in MongoDB. The catalogue service reads products; ingestion maintains them. Native development uses `MONGODB_URL` and `MONGODB_DATABASE`. Existing database passwords must be rotated inside MongoDB as well as in Kubernetes; preserve the PVC.

See the [Minikube deployment guide](../../minikube/roboshop/README.md) for secret initialization, dependency ordering and troubleshooting. Production database availability, backups and TLS require separate platform configuration.
