# Kafka order-event stream

Kafka provides replayable analytics events alongside the existing RabbitMQ shipping
flow. The gateway's durable outbox still publishes to RabbitMQ with publisher confirms.
An independent quorum queue, `roboshop.kafka.orders`, feeds `kafka-bridge`, which publishes
to Kafka and acknowledges RabbitMQ only after broker delivery confirmation.
No Kafka calls or readiness dependencies are added to checkout or the storefront.

```
Commerce outbox → RabbitMQ roboshop.orders → shipping queue → shipping-service
                                         → kafka queue → kafka-bridge → Kafka
```

Topics (created idempotently by the bridge):

- `roboshop.orders.live.v1`: paid merchant orders with explicit live, non-demo provenance.
- `roboshop.orders.test.v1`: test/demo orders and any uncertain provenance.

Messages include event/order IDs, original minor-unit amount, currency, payment mode
and provenance. No customer identity, address, payment credentials or shipping details
are copied. The order ID is the Kafka partition key; eventId is the deduplication key.
This analytics stream does not initiate delivery. Trace context is forwarded when present.

## Deploy on the existing Minikube installation

First run the existing Create infrastructure workflow to create the new
`roboshop-kafka-bridge` ECR repository (added to the Terraform repository list).
Then, from the repository root on your build host:

```bash
bash scripts/build/build-push-ecr.sh kafka-bridge ai-gateway
bash scripts/deploy/deploy-minikube.sh kafka-bridge ai-gateway
```

One service folder (`services/kafka-bridge`) owns one StatefulSet (`kafka`):
the Kafka broker and Python bridge run as two containers in the same pod.
The broker uses the official Apache image; the bridge uses the service Dockerfile.
This keeps process restarts and logs independent while deploying both together.
The headless Service publishes not-ready addresses to avoid discovery deadlocks.
The deploy script applies and restarts this StatefulSet when selecting `kafka-bridge`. The existing Deploy-Minikube workflow also deploys Kafka and its bridge,
using the `latest` images produced by CI. No additional application secrets or
ConfigMaps are required; the bridge reuses `roboshop-secrets/RABBITMQ_PASSWORD`.
Deployments apply and restart without waiting for readiness.

Inspect the stream after a sandbox purchase:

```bash
kubectl -n roboshop-ai get pods -l app=kafka
kubectl -n roboshop-ai logs kafka-0 -c kafka-bridge --tail=50
kubectl -n roboshop-ai exec kafka-0 -c kafka -- /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --list
kubectl -n roboshop-ai exec kafka-0 -c kafka -- /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic roboshop.orders.test.v1 \
  --from-beginning --max-messages 1 --timeout-ms 10000
```

## Delivery and recovery

Delivery is **at least once**, not a distributed transaction. A crash after Kafka
accepts a message but before RabbitMQ acknowledges it can produce a duplicate.
Consumers must deduplicate by eventId in their own transactional storage. Producer
idempotence handles transport retries within a producer session, not crash replay.
Kafka failure causes reconnection with a five-second backoff and leaves messages
unacknowledged. The queue disables RabbitMQ's automatic delivery limit, so repeated
broker failures do not discard valid events. Malformed events are quarantined in
`roboshop.kafka.failed`; inspect and repair before replaying them.

Only events published after the Kafka queue binding exists are captured. Deploying
the updated gateway guarantees that binding before future publishes; historical
paid orders are not automatically replayed or modified.

Monitor RabbitMQ queue depth/disk space during Kafka outages: prolonged backlog can
exhaust shared broker storage and eventually affect other RabbitMQ traffic. Restarting
Kafka or the bridge preserves the queue and PVC. Scaling the StatefulSet to zero pauses
analytics but keeps accumulating events; it does not delete data.

## Development limits

The manifest is a single KRaft broker/controller, with no ZooKeeper, a 5 GiB PVC,
768 MiB requested memory and 1.5 GiB memory limit. Topics use three partitions,
replication factor one, seven-day retention and 256 MiB per-partition retention
(approximate, applied at segment boundaries). This is not highly available.
Use a replicated, authenticated TLS cluster for production; this Minikube setup
uses internal plaintext listeners only. No NodePort or Ingress exposes Kafka.
The included NetworkPolicy limits ingress to Kafka and bridge pods **only if the
cluster CNI enforces NetworkPolicy**; Minikube kindnet may not enforce it.
Add explicit policy access for any future consumer.

Local mocked verification:

```bash
PYTHONPATH=services/kafka-bridge python3 -m unittest discover -s services/kafka-bridge/tests -v
```

Configuration references:
[Apache Kafka Docker example](https://github.com/apache/kafka/tree/trunk/docker/examples),
[Confluent Python delivery callbacks](https://docs.confluent.io/kafka-clients/python/current/overview.html).

If you deployed the earlier separate bridge Deployment, remove that redundant
worker after applying the consolidated manifest:

```bash
kubectl -n roboshop-ai delete deployment kafka-bridge --ignore-not-found
```

The StatefulSet name, broker DNS, volume claim and cluster ID are preserved.
No PVC or existing events are deleted. Logs can be selected with `-c kafka` or
`-c kafka-bridge`. The two processes now share the same deployment/scaling lifecycle.
