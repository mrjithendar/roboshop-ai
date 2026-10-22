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

## Existing Deployment to StatefulSet

Back up the existing database before the controller transition. Expect a brief
MongoDB outage. Stop and fully remove the old controller/pod before starting the
StatefulSet with its volume:

```bash
kubectl --context=mk4 -n roboshop-ai delete deployment/mongodb --ignore-not-found --cascade=foreground --wait=true --timeout=120s
kubectl --context=mk4 apply -f services/mongodb/mongodb-minikube.yaml
kubectl --context=mk4 -n roboshop-ai get pods,pvc -l app=mongodb
```

If deletion times out, stop and investigate the old pod; do not force-delete it
and start another MongoDB process against the same volume. The deploy workflow
performs this same transition before applying data-service manifests. Repeated
runs leave the StatefulSet and its PVC intact. Do not delete the PVC or Secrets.

The application-only `deploy-minikube.sh` does not deploy databases; use the workflow
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

Build and deploy `ai-gateway`, `moks`, and `nginx` for history support. StatefulSet
conversion alone does not enable the application changes.
