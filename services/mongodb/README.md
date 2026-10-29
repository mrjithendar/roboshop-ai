# MongoDB accounts, catalogue and conversations

`mongodb-minikube.yaml` deploys a **single-replica StatefulSet** (`mongodb-0`).
The existing `mongodb` Service remains the application endpoint; `mongodb-headless`
provides stable pod DNS. It mounts the existing **`mongodb-data` PVC** at `/data/db`.
No replacement claim, database copy, password rotation or data reset is performed.
Keep replicas at one: this is a standalone MongoDB instance, not a replica set,
and its single data volume must never be shared by concurrent mongod processes.

`roboshop-secrets` still supplies `MONGO_ROOT_PASSWORD` and `MONGO_APP_PASSWORD`.
The initialization script runs only on an empty database. Accounts, sessions,
profiles, products, settings and saved Moks conversations remain in MongoDB.
Application collection `chat_history` is keyed by the authenticated account ID.

## Product catalogue (`catalog.js`)

All catalogue data lives in MongoDB (`roboshop.products`); no service bundles product
files. [`catalog.js`](catalog.js) is the single definition: a `mongosh` script whose
`CATALOG` block is a JSON array. It currently holds 32 robots, the original 20 plus 12
added demo robots. Each product is upserted by SKU with `$setOnInsert`, and the
script ensures the unique slug index. Re-running it never changes existing products:
admin edits, stock, prices, archived flags and revisions always win, and only missing
SKUs are added.

- **New database:** the ConfigMap `mongodb-catalog` (key `20-catalog.js`, file
  `minikube/mongodb/mongodb-catalog-configmap.yaml`) is mounted into
  `/docker-entrypoint-initdb.d` next to the application-user script. The official image
  runs both on an **empty** data volume only.
- **Existing database** (init scripts do not run again), run either command:

  ```bash
  kubectl -n roboshop-ai exec -i deploy/mongodb -- sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < services/mongodb/catalog.js
  npm run catalog:import          # Node driver with MONGODB_URL/MONGODB_DATABASE (also run by npm run dev)
  ```

  Use `exec ... statefulset/mongodb` if you deployed the StatefulSet. The root password
  stays inside the pod.
- **Adding products:** edit the `CATALOG` array, then run `npm run catalog:configmap`
  (a test fails if the ConfigMap copy is stale) and `npm test`. Import with one of the
  commands above. To change a product that is already live, use the admin console:
  editing the file does not update existing rows.

Adding the ConfigMap mount changes the MongoDB pod template, so the next MongoDB sync
restarts the pod briefly. Data on the volume is unaffected.

## Existing Deployment to StatefulSet

Back up the existing database before the controller transition. Expect a brief
MongoDB outage. Stop and fully remove the old controller/pod before starting the
StatefulSet with its volume:

```bash
kubectl --context=mk4 -n roboshop-ai delete deployment/mongodb --ignore-not-found --cascade=foreground --wait=true --timeout=120s
kubectl --context=mk4 apply -f minikube/mongodb/mongodb-catalog-configmap.yaml
kubectl --context=mk4 apply -f services/mongodb/mongodb-data-pvc-minikube.yaml, services/mongodb/mongodb-service-minikube.yaml, services/mongodb/mongodb-statefulset-minikube.yaml, services/mongodb/mongodb-headless-service-minikube.yaml
kubectl --context=mk4 -n roboshop-ai get pods,pvc -l app=mongodb
```

If deletion times out, stop and investigate the old pod; do not force-delete it
and start another MongoDB process against the same volume. The deploy workflow
performs this same transition before applying data-service manifests. Repeated
runs leave the StatefulSet and its PVC intact. Do not delete the PVC or Secrets.

The application-only `scripts/deploy/deploy-minikube.sh` does not deploy databases; use the workflow
or commands above for this transition. Existing Minikube hostPath storage can be
node-local: a StatefulSet does not make that volume replicated or portable. Do not
delete its node or cluster expecting data to survive. Backups and a production
MongoDB replica set/operator are separate concerns.

## Saved conversations

The gateway writes complete question/reply pairs atomically to `chat_history`;
each account retains its latest 40 successful exchanges. It does not save provider
credentials or session cookies. History requires both Moks service authorization
and the user's valid session. User IDs cannot be supplied by the browser.

Moks restores the history on page load/open and visible-page refresh checks. The
last two exchanges supply bounded, explicitly untrusted follow-up context. When
history cannot load, chat is disabled until recovery. Failed inference attempts
and unsent drafts are not stored; old browser-only conversations cannot be recovered.
Chat text is personal data: include this collection in backup/access/retention policies.
No existing user records are migrated or deleted.

Build and deploy `ai-gateway`, `moks`, and `web` for history support. StatefulSet
conversion alone does not enable the application changes.
