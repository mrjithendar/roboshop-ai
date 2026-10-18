# Kubernetes deployment

`robotshop-ai/` deploys seven application services and, by default, the NGINX
frontend/edge server. Application pods use ClusterIP networking, non-root users,
resource limits and health probes. The gateway has a persistent single-writer
ledger and must remain at one replica with the Recreate strategy.

Build and push three images from the repository root:

```sh
docker build -t YOUR-REGISTRY/robotshop-ai:YOUR-TAG .
docker build -f services/shipping-service/Dockerfile -t YOUR-REGISTRY/robotshop-shipping:YOUR-TAG .
docker build -f services/nginx/Dockerfile -t YOUR-REGISTRY/robotshop-nginx:YOUR-TAG .
```

The NGINX image compiles and deploys `services/frontend`; no separate frontend
runtime is needed. Use immutable release tags or digests in your deployment process.

## Required external services

Provision PostgreSQL, Redis and RabbitMQ separately using managed services or your
platform's operators. Their local Compose definitions and operating notes live in
`services/postgres`, `services/redis`, and `services/rabbitmq`; the chart deliberately
does not install single-node databases as production infrastructure.

Create Secrets in the release namespace through your secret-management process:

| Value | Secret keys |
| --- | --- |
| `shipping.databaseSecretName` | `SHIPPING_DATABASE_URL` for the runtime role |
| `shipping.migrationSecretName` | `SHIPPING_MIGRATION_DATABASE_URL` for the schema owner |
| `integrations.secretName` | `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`, `RABBITMQ_URL` |
| `paymentSecretName` | `PAYMENT_SERVICE_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| `agentSecretName` (optional) | `OPENAI_API_KEY`, `OPENAI_MODEL` |

The runtime database role needs schema USAGE, SELECT on shipping tables and INSERT
on `shipping.shipment_requests`. Shipping startup uses the owner credentials for initialization, closes that pool, then starts the runtime pool. No migration Job is deployed.
Database, cache and broker TLS are enabled in the chart; `RABBITMQ_URL` must use
`amqps://` with a certificate trusted by Node. Provision trusted certificates for
all clients. Private CA mounting is not currently exposed as a chart value.

```sh
helm lint infrastructure/helm/robotshop-ai \
  --set shipping.databaseSecretName=shipping-runtime \
  --set shipping.migrationSecretName=shipping-owner \
  --set integrations.secretName=robotshop-integrations
helm template robotshop infrastructure/helm/robotshop-ai \
  --set shipping.databaseSecretName=shipping-runtime \
  --set shipping.migrationSecretName=shipping-owner \
  --set integrations.secretName=robotshop-integrations
```

For deployment, provide these values plus your three image repositories/tags,
`publicOrigin`, payment Secret, and storage class in your environment values file:

```sh
helm upgrade --install robotshop infrastructure/helm/robotshop-ai \
  --namespace robotshop-ai --create-namespace -f YOUR-ENVIRONMENT-VALUES.yaml
kubectl -n robotshop-ai port-forward service/robotshop-nginx 3000:80
```

The chart does not provision Ingress, observability backends, NetworkPolicies, or
stateful-service backup/restore. Configure an HTTPS ingress/load balancer or use
`nginx.tlsSecretName` and `nginx.serverName`. Public origins must match actual browser
URLs. Set `otelTracesEndpoint` to your collector. Review
`docs/architecture/2026-10-18-review.md` before treating this as production-ready.
These are deployment instructions; no cluster deployment was performed.
