# ELK lab: Argo CD → namespace `elk` → https://jithendar.com/elk

This is an **optional, single-node, non-HA lab**, not a production logging service.
No command in this change has been run against the cluster. Files are prepared for
review and a later Git commit/push by the operator; Argo reads `master`, not local files.

## Architecture and ownership

Container stdout/stderr → Filebeat DaemonSet → **mutual TLS** → Logstash → HTTPS →
Elasticsearch. Kibana connects through ECK's authenticated TLS association. Traefik
serves `/elk` with the existing `jithendar/default` TLSStore and verifies the ECK
Kibana backend certificate. Kibana removes its own base path; there is **no strip-prefix
middleware**. Only port 443/Kibana is public. Login is mandatory; no anonymous user.
Use the trailing-slash entry URL: **https://jithendar.com/elk/**.

ECK 3.5.0 owns Elasticsearch and Kibana generated workloads, certificates and system
credentials. Argo owns their CRs, plus ordinary Logstash Deployment and Filebeat
DaemonSet manifests. No second operator should manage the same namespace. The three
Applications are deliberately **not in default deploy-all**. `elk-operator` installs
CRDs/operator; `elk-core` installs storage/search/UI and internal certificates;
`elk-pipeline` bootstraps permissions/retention before starting collection.

Existing OTLP traces, Prometheus/Grafana and Langfuse remain unchanged. This collector
reads only `roboshop-ai` and `traefik` container symlinks, including gateway, Moks,
MCP, catalogue, users, cart, payment, shipping, currency, NGINX, Kafka/RabbitMQ and
background containers in those namespaces. It does not collect Kubernetes API
Events, host journals, audit logs, or kube-system logs. The workload-errors search
shows application/infrastructure **log errors**, not pod scheduling Events.

## Pins, licensing and source decisions

Checked official documentation on 2026-10-26:

- [ECK releases](https://www.elastic.co/docs/release-notes/cloud-on-k8s): **3.5.0**.
  The corresponding chart was downloaded from the official Helm index and rendered locally.
- [Stack releases](https://www.elastic.co/docs/release-notes): **9.5.5**, used consistently
  for Elasticsearch, Kibana, Filebeat and Logstash. Pins are not floating `latest` tags.
- [Official Helm deployment](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s/install-using-helm-chart).
- [ECK license](https://www.elastic.co/docs/deploy-manage/license/manage-your-license-in-eck):
  this configuration uses free Basic functionality, with no trial/Enterprise features.
  Official Elasticsearch/Kibana distributions use Elastic's distribution license;
  do not assume Apache licensing for the whole stack. Review
  [Elastic licensing](https://www.elastic.co/pricing/faq/licensing) before redistribution.
- [Kibana settings](https://www.elastic.co/docs/reference/kibana/configuration-reference/general-settings):
  basePath `/elk`, rewriteBasePath true, publicBaseUrl includes `/elk`.
- [Filestream](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-filestream):
  stable IDs, fingerprint identity, container parser and multiline handling.
- [Host prerequisites](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/bootstrap-checks):
  recommended vm.max_map_count 1048576, never applied by an init container.

The separate bootstrap Job uses `python:3.13.9-slim` and standard-library HTTPS.
Image pulls, architecture manifests, ECK reconciliation, Logstash plugins and the live
Kubernetes version have **not** been verified on this lab. Check the official ECK
support matrix and image availability before syncing; do not assume a future Kubernetes
release is supported merely because the manifests render.

## Resource/storage budget

| Component | Replicas | CPU request / limit | RAM request / limit | Heap/storage |
| --- | --- | --- | --- | --- |
| Elasticsearch | 1 | 500m / 2 | 4 GiB / 4 GiB | 1 GiB heap, 512 MiB direct; 40 GiB PVC |
| Kibana | 1 | 250m / 1 | 1 GiB / 1.5 GiB | Node heap 768 MiB |
| Logstash | 1 | 250m / 1 | 1 GiB / 1.5 GiB | heap 512 MiB, direct 256 MiB; 2 GiB PVC, 1 GiB queue |
| ECK | 1 | 100m / 500m | 256 MiB / 512 MiB | namespace scoped |
| Filebeat | per node | 50m / 250m | 128 MiB / 256 MiB | 1024-event memory queue; persistent node registry |
| Bootstrap | transient | 50m / 250m | 64 MiB / 128 MiB | no PVC |

At 4 nodes: requests ~6.75 GiB/1.3 CPUs; limits ~8.5 GiB/5.5 CPUs.
At 8 nodes: requests ~7.25 GiB/1.5 CPUs; limits ~9.5 GiB/6.5 CPUs.
These are reservations/ceilings, **not measured free capacity**. The 16-vCPU/32-GB
host is shared with builds and other apps; reserve host/page-cache headroom. A 2-GB
Minikube node cannot schedule this Elasticsearch pod. Provide at least one node with
5 GiB allocatable and enough *unrequested* RAM; 6–8 GiB for that node is preferable.
Adding nodes does not add physical RAM. Do not recreate an existing profile casually.

`standard` is assumed to be the existing Minikube RWO hostPath provisioner. Confirm
multi-node placement/local-volume behavior before syncing; it is not replicated
storage. 42 GiB requested PVC capacity plus container logs/registry overhead must fit
the host disk. Minikube hostPath PVC sizes may not enforce a disk quota.

## Namespace change

The target namespace is now `elk` (previously `els`), with Secret `elk-credentials`.
This is a fresh-install configuration, not a data migration. If `els` was already
installed, do not switch destinations or run a second collector blindly: preserve
its PVCs/credentials, stop collection, and plan snapshot/restore before transitioning.
An existing ECK operator must watch `elk`; do not install another operator.

## Ordered deployment (explicit operator commands)

Run from the repository root with the correct kubeconfig. These steps **do change**
the cluster when you execute them. First review and publish the Git changes yourself.

```bash
# Local/offline: no cluster calls
python3 scripts/observability/elk.py render > /tmp/elk-rendered.yaml
python3 -m unittest discover -s tests -p test_elk.py -v
python3 scripts/observability/elk.py credentials       # preview
python3 scripts/observability/elk.py dashboards        # preview

# Read-only remote inventory; review operators and overlapping collectors
python3 scripts/observability/elk.py preflight --context mk4
kubectl --context=mk4 describe nodes
kubectl --context=mk4 top nodes
kubectl --context=mk4 top pods -A --sort-by=memory
```

On the **Hetzner Linux host**, not the Mac, explicitly inspect/apply the kernel setting:

```bash
bash minikube/host-limits.sh --elk --dry-run
bash minikube/host-limits.sh --elk --apply
# Docker nodes share the host kernel; confirm inside the chosen node as well:
minikube ssh -p mk4 -- sysctl vm.max_map_count
```

Back on your Kubernetes client:

```bash
# Creates missing secret only; repeat runs preserve all keys. Nothing is printed.
python3 scripts/observability/elk.py credentials --context mk4 --apply
kubectl --context=mk4 apply -f argocd/project-elk.yaml

# ONLY if preflight found no existing ECK operator/CRDs:
kubectl --context=mk4 apply -f argocd/elk-operator.yaml
python3 scripts/observability/elk.py sync --app elk-operator --context mk4 --apply

kubectl --context=mk4 wait --for=condition=Established crd/elasticsearches.elasticsearch.k8s.elastic.co --timeout=120s

# If ECK already exists: skip the preceding operator install; its owner must add
# elk to its watched namespaces and confirm compatibility. Never install a second.
kubectl --context=mk4 apply -f argocd/elk-core.yaml
python3 scripts/observability/elk.py sync --app elk-core --context mk4 --apply
kubectl --context=mk4 -n elk wait elasticsearch/logs --for=jsonpath='{.status.health}'=green --timeout=600s
kubectl --context=mk4 -n elk rollout status deployment/logs-kb --timeout=600s
kubectl --context=mk4 -n elk wait certificate/logstash-server certificate/filebeat-client --for=condition=Ready --timeout=180s

kubectl --context=mk4 apply -f argocd/elk-pipeline.yaml
python3 scripts/observability/elk.py sync --app elk-pipeline --context mk4 --apply

python3 scripts/observability/elk.py dashboards --context mk4 --apply
```

The sync helper uses the Kubernetes Application API, so it needs only your working
kubectl context—not an Argo CD CLI server/login. It waits for its own sync operation,
without accepting an earlier success. Workload readiness is checked separately.
The Argo UI at `/argocd/` remains an alternative for syncing in the same order.
The bootstrap Sync Job
has a bounded deadline and runs before the collector/workload wave. It uses admin
rights only to install ILM/templates/aliases/restricted users. Regular ingestion
has cluster monitor and `create_doc` for two fixed index families, not superuser.

Do not enable automatic pruning or add resource-deletion finalizers to these apps.
CRDs remain a shared cluster installation: never delete them as routine stack cleanup.

## Credentials and dashboard access

ECK generates `elk/logs-es-elastic-user` for emergency/bootstrap administration.
`elk/elk-credentials` holds the separate ingestion password, viewer password and
three Kibana encryption keys. No real credentials or private certificates are in Git.
The default login is **elk_viewer**; it can read logs but not manage the cluster.
Do not use `elastic` for everyday browsing or ingestion.

On your Mac, copy the viewer password directly to the clipboard (not terminal/logs):

```bash
kubectl --context=mk4 -n elk get secret elk-credentials \
  -o jsonpath='{.data.viewerPassword}' | base64 --decode | pbcopy
```

On Linux use a password manager or a private temporary file with `umask 077`, never
CI output or shell tracing. Clipboard contents are sensitive; clear after use.
Do not rotate only the Kubernetes password without rerunning bootstrap and restarting
Logstash. Back up the Kibana encryption keys; replacing them breaks encrypted objects.

Open **https://jithendar.com/elk/** and import the supplied dashboard using the script
above (authenticated admin HTTPS, verified public CA, no secrets in arguments/logs).
Alternatively import `dashboards/roboshop.ndjson` through Kibana Saved Objects using
an authorized administrator. Six saved searches and a combined support dashboard
cover errors, HTTP failures/latency, auth/reset, payments, AI and infrastructure.
The viewer cannot import objects. Saved-object compatibility must still be checked
against the running pinned Kibana version.

Example KQL (set the time picker appropriately):

```text
trace.id: "0123456789abcdef0123456789abcdef"
service.name: "user-service" and log.level: "error"
diagnostic.errorCode: "RESET_EMAIL_DELIVERY_FAILED"
service.name: (ai-gateway or payment-service or cart-service) and trace.id: "<trace-id>"
```

A checkout spanning multiple independent traces needs the application's trace links;
we deliberately do not index customer or order identifiers as correlation shortcuts.

## Parsing, privacy and collector behavior

Actual source formats inspected: Node/Python structured `timestamp`, `event`,
`traceId`, `spanId`, `durationMs`; Go slog `time`, snake-case trace IDs; NGINX JSON
`duration` in seconds; Java/Spring and broker plaintext. Traefik JSON duration is
nanoseconds when enabled. Generic plaintext exports severity/exception **class**,
not free-form text. Java exception continuation lines are joined before output,
limited to 100 lines, 64 KiB and a 3-second flush. Unknown plaintext formats retain
only a safe diagnostic event, not guessed fields.

The actual Ruby filter is shared by tests and Logstash. It rebuilds each document
from an allowlist, retains diagnostic codes and trace/span IDs, and discards raw
messages, tokens, cookies, headers, addresses, personal names/email, prompt/response
bodies, stack contents and arbitrary unknown keys. This intentionally sacrifices
original payload fidelity for privacy. Safe known fields are normalized; unsupported
fields are not retained even in `_source`. No user input, service name or URL chooses
an index. Source RFC3339 timestamps retain up to 9 fractional digits in `event.created`;
the Elasticsearch ingest date processor writes nanosecond `@timestamp`. Invalid
records use a fixed one-day quarantine index with payload discarded.

Application-side safe logging remains essential. Filebeat memory and the Logstash
persistent queue see **pre-filter records**; restrict host/PVC access and use encrypted
host storage. Redaction before indexing does not erase source container logs. Prompt
capture must remain disabled in applications; this stack does not turn it on.

Filebeat runs UID 0 without privileged mode, host networking or extra capabilities
because host log files may be root-readable. `/var/log/containers` and `/var/log/pods`
are read-only. Only container **symlinks** are harvested; the pod directory resolves
symlinks and is never a second input. Fingerprints and stable input IDs track rotation;
registry/checkpoints live in `/var/lib/roboshop-filebeat` on each Minikube node. Do not
rename inputs casually. Short files under 64 bytes wait for more content. Registry
loss or replay can produce duplicates. If node admission/SELinux blocks host mounts,
review a narrow policy; do not disable SELinux or grant blanket privileged access.

Collector/ELK routine logs are excluded from ingestion; inspect them with `kubectl
logs -n elk` and normal node rotation, rather than creating a feedback loop. A node
can briefly lag during Filebeat restarts. Persistent queues/backpressure are bounded;
long outages plus container rotation can lose logs. Delivery is **not exactly once
or guaranteed lossless**. Elastic rejects malformed mapping documents without a
raw-payload DLQ; watch Logstash output diagnostics for discarded records.

## Retention, disk, certificates and recovery

Bootstrap owns templates/ILM. One primary shard, zero replicas. Normal indices roll
over at 2 GiB or one day, then expire seven days after rollover (roughly up to eight
days total). Quarantine rolls at 256 MiB/day and expires one day after rollover.
ILM is asynchronous, not a hard disk quota. Empty indices need not roll. ES watermarks
are 80/85/90 percent; the flood stage blocks writes. Alert on filesystem usage and
queue saturation using the existing monitoring stack.

For disk-full recovery: stop collection if necessary, free safe unrelated disk space
or expand the backing storage, inspect ILM errors, and only then clear any remaining
read-only blocks. Never delete the data directory or write alias blindly. PVC expansion
depends on the StorageClass's `allowVolumeExpansion`; Minikube hostPath often needs
host capacity management rather than just a larger claim. Persistent data is not a
backup: configure an Elasticsearch snapshot repository on separate durable storage
before relying on these logs. This change does not provision a snapshot bucket.

cert-manager renews internal mTLS certificates, but Logstash/Filebeat TLS reload must
be verified. Restart Logstash and Filebeat after renewal/CA rotation (with overlap,
before expiry); do not assume mounted-file rotation reloads every plugin. Monitor
Certificate readiness/expiry. ECK manages its own ES/Kibana associations. A CA rollover
needs an explicit trust-overlap plan, not deleting the issuer Secret.

## Verification and troubleshooting

Static checks performed locally: both Kustomize layers rendered; pinned ECK chart
rendered; actual Ruby filter tested with synthetic Python/Node/Go/NGINX/Java-style
records including PII, malformed values, trace IDs and nanosecond timestamps. These
checks do not execute the Logstash JVM, ES date processor or real ingestion.

Optional after deployment:

```bash
kubectl --context=mk4 -n elk get pods,pvc,certificate
kubectl --context=mk4 -n elk logs deployment/logstash --tail=80
kubectl --context=mk4 -n elk logs daemonset/filebeat --tail=80
curl --fail --location --max-time 20 https://jithendar.com/elk/login -o /dev/null
# Synthetic stdout in a collected namespace. This DOES create a short-lived pod.
kubectl --context=mk4 -n roboshop-ai run elk-smoke --restart=Never \
  --image=busybox:1.37.0 -- sh -c 'echo "{\"event\":\"elk_smoke\",\"level\":\"ERROR\",\"traceId\":\"0123456789abcdef0123456789abcdef\"}"; sleep 10'
# Search event.action: elk_smoke in Kibana. Check exactly one record per emitted line.
kubectl --context=mk4 -n roboshop-ai delete pod elk-smoke
```

Verify login, redirect, JS/CSS assets, Discover queries and `/elk/api/status` in the
browser; a login HTTP 200 alone is not proof dashboards/ingestion work. Test a
rotation/restart and inspect duplicate counts with a unique synthetic trace ID.
Use Kibana Dev Tools as admin to inspect `_ilm/explain`, index replica counts and
`_cat/allocation`, never expose Elasticsearch through a public ingress.

- Pending ES: inspect node requests/allocatable, PVC placement and free disk; 2-GB nodes are too small.
- Bootstrap failed: inspect Job status/log type/status, ES health and secret references. Never paste passwords.
- No data: verify source namespace/path, Filebeat RBAC, registry permissions, mTLS certificates and Logstash readiness.
- 403 ingestion: resync bootstrap, confirm writer role/aliases; do not switch writer to elastic.
- 404/assets: verify `/elk`, basePath/rewrite setting, no StripPrefix and no competing ingress rule.
- TLS backend 500: inspect ServersTransport and `logs-kb-http-certs-public`; do not disable verification.
- No metrics/event logs: this is stdout collection, not Kubernetes Event watching or metrics collection.

## Removal: preserve data by default

First ensure automation is disabled. The Applications intentionally have no cascading
finalizers. Remove their Argo registrations **non-cascading**, then stop only the
collection/UI workloads you intend to stop:

```bash
argocd app delete elk-pipeline --cascade=false
argocd app delete elk-core --cascade=false
kubectl --context=mk4 -n elk delete daemonset/filebeat deployment/logstash kibana/logs ingressroute/elk
# Optional: remove ES CR; DeleteOnScaledownOnly retains its PVC on CR deletion.
kubectl --context=mk4 -n elk delete elasticsearch/logs
```

Retain `elk` namespace, credentials, CA Secrets, ES PVC and Logstash PVC. Re-adoption
with the same CR/nodeSet names and credentials requires checking retained PVCs first.
Leave a shared ECK operator and cert-manager alone. The pipeline RBAC can be removed
separately after collectors stop. **Deleting namespace elk deletes data/credentials.**
For deliberate destruction, first export snapshots and enumerate PVCs; then explicitly
name the PVCs in `kubectl delete pvc -n elk <reviewed-names>`. There is no default wipe
script or wildcard PVC deletion. Node registry deletion also requires deliberate host
maintenance; do not remove checkpoints while collectors are active.

### Implementation verification record (2026-10-26)

- `python3 -m pytest tests/test_elk.py -q`: **6 passed** (actual Ruby filter via an
  Event shim, manifest rendering, secret/RBAC references, retention, dashboard
  references and read-only previews).
- Pinned ECK Helm chart rendered; Elasticsearch/Kibana objects validated against
  that chart's CRD schemas with `jsonschema`.
- `python3 scripts/argocd/validate.py`: existing catalog passed (26 Applications,
  69 unique resources; external charts not included by that command).
- Existing Argo tests: **9 passed, 4 failed**. All four failures also reproduced in
  an isolated `git archive HEAD` export: stale expected Application membership/counts
  in deploy/catalog tests and expected LOG_FORMAT=text while the repository uses json.
  No unrelated expectations were rewritten to hide these failures.
- Python compilation, Ruby syntax, shell syntax and `git diff --check` passed.
- ShellCheck unavailable. Docker daemon unavailable; no JVM/parser plugin startup,
  disposable ingestion, real ES timestamp processing, live certificate/RBAC checks
  or Kibana browser/dashboard verification performed. No host packages installed,
  live resources changed, data deleted, commits or pushes made.


### macOS command troubleshooting

`flags cannot be placed before plugin name: --context` was caused by the preflight
placing `-A` before `get`. The helper now puts namespaced flags after `get` and omits
`-A` for nodes/CRDs. `Argo CD server address unspecified` means the standalone Argo
CLI lacks a server/login; use the kubectl-based sync helper above instead. Applying
an Application alone does not sync it because automatic sync is intentionally off.
An absent `logs-kb` Deployment is therefore expected until core sync and ECK
reconciliation complete. In interactive zsh, enable pasted comments with
`setopt interactivecomments`, or run multi-step blocks in `bash` with `set -e` so a
failed prerequisite stops subsequent changes.


### Failed operator sync: namespace not found

The kubectl sync helper explicitly copies `spec.syncPolicy.syncOptions` into the
requested `operation.sync.syncOptions`; API-triggered operations cannot rely on
implicit inheritance. This preserves CreateNamespace and shared-resource checks.
It also requests a hard refresh before syncing after a Git update. If Argo reports
`namespace els is not permitted`, inspect the compared Git revision: the old
revision targeted els. Publish the elk manifests and refresh; do not permit els in
the project just to conceal the mismatch. Sync operator, core, then pipeline again.
A successful sync is not a capacity or ingestion verification.

The sync helper now waits for hard-refresh completion and rejects manifests still
rendering `els` before requesting sync. It also checks for a Ready ECK operator
before core sync, and healthy Elasticsearch plus Ready mTLS certificates before
pipeline sync. Failed prerequisites stop the command; they do not trigger a
second operator install, namespace migration, credential rotation or pruning.
Regression coverage: `python3 -m pytest tests/test_elk.py -q` (11 tests).


### Elasticsearch OOM prevents Kibana access

Observed in the lab: Elasticsearch exited 137/OOMKilled with a 3-GiB container
limit and 1536-MiB heap. Kibana then had no Elasticsearch connection, its service
had no Ready endpoints, and Traefik returned 503. The host mmap setting was already
1048576. The lab profile now reserves/limits 4 GiB, with a 1-GiB heap and 512-MiB
direct-memory ceiling to leave more native/page-cache headroom. This is a sizing
correction, not proof of runtime recovery. Verify rollout and memory consumption.
If OOM continues, inspect the outer Minikube Docker memory limit too: Kubernetes
node allocatable values may reflect shared host capacity. Do not increase limits
without checking actual physical RAM and other workloads.


### Data-volume permission failure after the OOM fix

A subsequent live boot reached filesystem initialization but exited with
`AccessDeniedException: /usr/share/elasticsearch/data/node.lock`. Minikube's
hostPath PV did not honor the existing fsGroup sufficiently. Elasticsearch and
Logstash now have a `data-permissions` init container: UID 0, no privileged mode,
read-only root filesystem, only CHOWN/FOWNER/DAC_OVERRIDE capabilities and only the
application data PVC mounted. It changes ownership to UID/GID 1000 and sets the
volume root to mode 0770; it does not delete data or grant world-write access.
This is a deliberate lab exception for hostPath, not a general host permission
change. Admission policies that prohibit root init containers must instead arrange
ownership through the storage administrator. Large retained volumes can make the
recursive ownership pass slow. Preserve the volume and never delete node.lock as a
workaround. If a pod changes Minikube nodes, check local storage placement before
starting: this provisioner does not attach a replicated volume across nodes.
