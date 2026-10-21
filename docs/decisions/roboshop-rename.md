# RoboShop naming migration

All maintained source references now use `roboshop` (display name `RoboShop`).
This includes image/repository names, Kubernetes namespaces and configuration
names, Java packages, runtime defaults, tests and documentation. Deployment
manifests now live under `minikube/roboshop/`.

This is a source rename, not a migration of running infrastructure or user data.
Git history is unchanged; the source edit does not rename external checkouts.
Ignored local environment files and generated artifacts are not rewritten.

Before deploying to an existing environment:

1. Back up databases, persistent volumes, Terraform states and application secrets.
2. Review Terraform plans for replacement/deletion caused by ECR, EKS, IAM and
   resource-name changes. Do not apply a broad replacement plan blindly. Existing
   ECR configuration has `force_delete=true`, which can delete stored images.
3. Build/publish images to the newly named ECR repositories before applying the
   new manifests. Update external CI settings or IAM policies using previous names.
4. Kubernetes namespaces cannot be renamed. Prepare the `roboshop-ai` namespace
   with credentials/configuration, and explicitly migrate application data/PVCs.
   Keep the existing deployment until the new one is verified and traffic is moved.
5. Database defaults now use the new spelling. Changing a MongoDB database name
   does not transfer accounts, products or history. Either migrate the database
   deliberately, or configure `MONGODB_DATABASE` with the existing database name
   during transition. Check database users/roles separately.
6. Reconcile queue/exchange, cache, session and cookie names with the existing
   deployment; a rename may require login again and handling outstanding events.
7. Update DNS/ingress destinations only after verifying application and payment
   flows. Remove old resources only after confirming data and traffic migration.

The code changes do not rename cloud resources, delete data, restart workloads,
or push images. Rebuild generated outputs from the updated source.
