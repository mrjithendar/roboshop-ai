# Isolated k6 load lab

This is an executable, **synthetic, mock-only lab by default**, not a production
benchmark. It starts real gateway FastAPI, user-service authorization/session
validation, Moks widget/LangGraph/provider routing and payment-service processes.
The real Razorpay adapter validates callback HMAC, captured state, amount and
currency against an in-memory Razorpay-protocol mock. No settlement occurs.
Ollama requests use the real adapter against an Ollama `/api/chat` protocol mock.
Shipping quotes and catalogue upstream reads are fixture responses; gateway
product detail/cart/history/checkout paths are real application handlers.

The default lab uses MongoMock and the existing **single-writer JSON commerce
backend**, not PostgreSQL/Redis/MongoDB servers. No outbox worker is started, so
email, brokers, purchase-history projection and delivery have no external side
effects. This validates HTTP contracts, authorization, scenarios and basic
single-process commerce correctness; it does **not** validate PostgreSQL locking,
Redis recovery, real Mongo performance, deployment throughput or production
catalogue/search latency. Use `tests/commerce` against its isolated PostgreSQL and
Redis fixtures for existing cross-process reservation/recovery tests. Do not
report the mock lab as a full microservice capacity test.

## Native setup and first test

Run from the repository root. Python 3.14 and Node 26 match application images;
the smaller smoke was also checked locally with Python 3.11. Dependencies are
pinned by the service requirement files. curl is needed only for installation.

```bash
python3 -m venv tests/load/.venv
tests/load/.venv/bin/pip install -r tests/load/requirements.txt
tests/load/.venv/bin/python tests/load/install-k6.py
tests/load/.venv/bin/python -m unittest discover -s tests/load -p 'test_*.py'

# Recommended first run: 1 VU, 2 seconds, no network beyond spawned loopback services.
tests/load/.venv/bin/python tests/load/lab.py run \
  --scenario browse --seconds 2 --vus 1 \
  --k6 tests/load/.tools/k6

# Each invocation generates and prints a fresh run ID and results directory.
# After inspecting summary.json and verification.json, use that printed ID:
tests/load/.venv/bin/python tests/load/lab.py cleanup --run-id YOUR_PRINTED_RUN_ID
```

`lab.py` prepares up to 50 independent accounts/sessions (100 max), unique per-user
SKUs, simulated inventory, a three-unit shared limited-stock SKU and test-only
secrets **before** measured traffic. No registration endpoint or bot check is
disabled. The `session` scenario measures `/api/auth/me`, **not password login or
Turnstile performance**. Automating real challenges faithfully is out of scope;
password-login load must not be claimed from this scenario.

All subprocesses use a minimal environment, not inherited AWS/SES/Langfuse,
production database, superadmin or payment credentials. Existing deployments and
data are never modified. Private fixtures and raw logs live in `.runs/` folders with restrictive
permissions and are individually ignored. Only sanitized `summary.json`,
`verification.json` and `environment.json` are eligible for Git tracking. Never upload fixtures, ledger snapshots,
provider reports or raw logs. CI uploads only sanitized numeric summaries,
verification and environment metadata, then deletes its own run directory.
An active marker prevents cleanup of a running lab; an interrupted force-killed
launcher may require inspection before manually removing its stale marker.

## Scenarios and profiles

Select exactly one scenario per run; every HTTP operation has a separate tagged
latency series and thresholds. Synthetic state is new for every run ID.

| Scenario | Real HTTP path exercised | Correctness |
|---|---|---|
| browse | products, catalogue search, product detail | synthetic products present |
| session | auth/me via real user-service | expected account ID |
| cart | cart POST/GET | own SKU, integral quantity 1–20 |
| checkout | cart, shipping, payment orders/verify | immutable test/demo provenance, captured status |
| idempotency | checkout plus duplicate order and callback requests | same logical order and single provider receipt |
| limited-stock | concurrent shared three-unit stock purchases | post-run reservations/sales never exceed three |
| chat | widget → gateway → Moks → mock Ollama, two turns | AI answers, bounded current question at mock boundary |
| isolation | per-user cart and two-turn history | other users' message markers never appear |
| rate-limit | repeated session reads, no pacing | 429 expected; other failures remain unexpected |
| real-ai | **manual opt-in only**, one chat per iteration | bounded real inference attempts |

Profiles are starter loads, not promised capacity:

- `smoke`: 1–2 VUs, 2 minutes (lab CLI defaults to 2 VUs).
- `baseline`: 5 VUs, 5 minutes: pass `--vus 5` explicitly to the lab CLI.
- `ramp`: 10 VUs/1 minute, 20/2 minutes, 50/2 minutes, then ramp down/1 minute.
- `soak`: 30 minutes; choose sustainable `--vus` explicitly.
- `arrival`: fixed iterations per second (`RATE`, default 1), fixed preallocated
  VU ceiling; `dropped_iterations` reports load the generator could not deliver.

```bash
# New run ID for each independent scenario.
tests/load/.venv/bin/python tests/load/lab.py run \
  --run-id load-checkout --scenario idempotency --profile smoke --vus 2 \
  --k6 tests/load/.tools/k6

# Manual only; do not run these just to validate installation.
RATE=1 tests/load/.venv/bin/python tests/load/lab.py run \
  --run-id load-arrival --scenario browse --profile arrival --vus 5 \
  --k6 tests/load/.tools/k6
```

Omit `--run-id` for repeatable quick-start commands: a new ID is generated each
time. Explicit IDs are never overwritten; a collision exits with cleanup/new-ID
instructions and preserves existing results.

Native CLI supports `--seconds` for short CI checks. Direct k6 supports `BASE_URL`,
`TARGET_ALLOWLIST` (exact comma-separated origins, mandatory), `FIXTURES`, `RUN_ID`,
`SCENARIO`, `PROFILE`, `DURATION`, `VUS`, `RATE`, `PACE_SECONDS`, `WARMUP_SECONDS`
and `RESULT_DIR`. The fixture origin/run identity must match the target's test-only
identity route. jithendar.com and its subdomains are rejected. Never add deployed
production targets to the allowlist. Redirects are disabled.

Each VU retains its own cookie jar and cart. Separate checkout attempts use new
run/VU/iteration idempotency keys; duplicate/replay checks deliberately reuse the
key only for the same checkout. Pending reservations are never force-released.
`verify --run-id ...` reads only test-owned ledger snapshots and mock receipts;
it checks duplicate logical keys, provider receipts, test provenance and stock.

Pacing defaults to one second, or 30 seconds between two-turn chat journeys.
Arrival-rate scheduling supplies its own pacing, as described in
[k6's executor documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).
The gateway's existing 300 requests/minute/client and 10 AI requests/minute/client
limits remain active. In this disposable lab only, known synthetic session cookies
map to separate simulated client identities, so 50 users do not share one IP
bucket. Unknown sessions still use the real peer address. Production address
resolution, authorization and thresholds are unchanged. This simulates customers
on separate networks, not many customers behind one NAT.

The `rate-limit` scenario retains the shared peer bucket to verify throttling.
Per-user limits and global AI concurrency limits can still reject overly fast
traffic; do not hide these failures. Environment reports record the selected mode.


## Metrics, thresholds and chaos

`summary.json` contains per-operation p50 (`med`), p95, p99 and maximum latency,
successful operations, completed journeys, unexpected failure rate, correctness
failures, admission rejections, AI accepted requests, successful answers and
successful-answer latency. `throughput` excludes setup/warm-up time, reports
achieved journeys/operations per second and offered arrival rate/dropped work.
Fast 200 responses with not-configured/clarification/unavailable content never
count as AI successes. Widget responses do not expose provider model, failover
reason or token usage; the load runner does not invent them. Inspect correlated
server traces for those fields when using a separately instrumented test stack.

Defaults are **provisional test gates**, not measured SLOs: unexpected rate <1%,
zero correctness failures, zero capacity admission rejections, positive completed
journeys, p95 <3 seconds for non-AI operations and <16 seconds for successful AI.
Override `MAX_UNEXPECTED_RATE`, `P95_MS`, `AI_P95_MS`, `MAX_REJECTIONS`, `MAX_DROPPED`
only with an explicit recorded rationale. Successful-answer latency is separate
from fast rejections; neither replaces throughput or correctness checks.

Mocks support `MOCK_LATENCY_MS`, `MOCK_ERROR_EVERY`, `MOCK_STATUS` (429/503 etc.)
and `MOCK_TIMEOUT_MS` (up to 20 seconds). These affect provider traffic only.
Fault runs normally fail capacity thresholds: that is an actual result, not a
reason to classify provider failures as successes. CI uses healthy mocks.
No mocked answer should be treated as product advice or evidence of LLM quality.

## Docker / Minikube (explicit operator actions)

```bash
docker build -f tests/load/Dockerfile -t roboshop-load-lab:local .
# Internal Docker network prevents Internet egress; host access is loopback only.
docker network create --internal roboshop-load-isolated
docker run --rm --name roboshop-load-lab --network roboshop-load-isolated \
  -p 127.0.0.1:18080:18080 roboshop-load-lab:local
# In another shell copy private synthetic fixtures, then run k6 outside the container:
docker cp roboshop-load-lab:/workspace/tests/load/.runs/load-container/fixtures.json /tmp/load-fixtures.json
chmod 600 /tmp/load-fixtures.json
BASE_URL=http://127.0.0.1:18080 TARGET_ALLOWLIST=http://127.0.0.1:18080 \
  FIXTURES=/tmp/load-fixtures.json RUN_ID=load-container SCENARIO=browse VUS=1 \
  tests/load/.tools/k6 run tests/load/load.js
# Stop the container; remove only its dedicated network and copied fixtures.
docker stop roboshop-load-lab
docker network rm roboshop-load-isolated
rm /tmp/load-fixtures.json
```

For Minikube, explicitly select your **test cluster context**, load the image and
apply `tests/load/minikube.yaml`. The manifest creates only
`roboshop-load-testing`, disables service-account credentials, and denies pod
network traffic. Verify your CNI enforces NetworkPolicy; otherwise use an isolated
cluster with host egress controls. Port-forward works through the API server:

```bash
minikube -p YOUR_TEST_PROFILE image load roboshop-load-lab:local
kubectl --context=YOUR_TEST_CONTEXT apply -f tests/load/minikube.yaml
kubectl --context=YOUR_TEST_CONTEXT -n roboshop-load-testing port-forward deployment/load-lab 18080:18080
# Separate shell; copy the same private fixture path from the pod.
kubectl --context=YOUR_TEST_CONTEXT -n roboshop-load-testing cp \
  POD_NAME:/workspace/tests/load/.runs/load-container/fixtures.json /tmp/load-fixtures.json
# Run the direct k6 command above from your workstation.
# Remove only test-owned resources after saving sanitized reports:
kubectl --context=YOUR_TEST_CONTEXT delete -f tests/load/minikube.yaml
```

Prefer an external generator for comparisons. A lab running generator and services
on one constrained node competes for CPU/memory; environment.json records this.
Minikube measurements do not establish EKS production capacity. Native `serve`
mode supports the same external-generator pattern; Ctrl-C stops its subprocesses.

## Optional real-model runs

The disposable lab always uses mock inference. To test a real **administrator-
approved isolated application**, prepare a separate synthetic fixture file with
`synthetic: true`, matching `runId`/`baseUrl`, `providerMode: "real-approved"` and
valid synthetic users (`id`, `session`, `sku`) using that environment's approved
fixture process. Do not reuse the lab's sessions on another application.
The runner never changes provider configuration and checks `/api/status` is AI
configured. It calls only the existing widget chat path and creates no payments.

```bash
REAL_AI_ENABLED=yes REAL_AI_MAX_REQUESTS=5 SCENARIO=real-ai \
  BASE_URL=https://YOUR-ISOLATED-TEST-ORIGIN \
  TARGET_ALLOWLIST=https://YOUR-ISOLATED-TEST-ORIGIN \
  FIXTURES=/secure/path/approved-load-fixtures.json RUN_ID=load-real-approved \
  tests/load/.tools/k6 run tests/load/load.js
```

Real mode forces one VU, 1–10 total requests, 60-second scheduling duration, fixed
short prompts, and no second-turn call. Existing server prompt/output limits
remain in force (600 output tokens where supported). One failover per request
means at most twice the configured request count in generation attempts; in-flight
requests can finish during the 25-second grace period. Administrator changes or
server retries outside the reviewed router invalidate this bound. Request/token
caps limit exposure, **not an exact dollar ceiling**. Bedrock charges and external
data processing still apply. No cost estimate is emitted without pricing and
actual token metadata. Real inference is never run in CI or automatically.

## Observability and fair comparisons

No run ID enters Prometheus labels or span names. First-iteration request trace
IDs are printed as metadata for correlation; cookies, bodies and session values
are never printed by the generator. Default lab exporters are disabled to avoid
sending synthetic data to an inherited collector/Cloud account. For an existing
instrumented isolated stack use its approved OTel sampling/privacy settings and
trace IDs from k6; inspect provider attempts, dependencies and outbox workers there.
See `observability.md` for existing-stack Grafana/Prometheus queries.

Compare the same commit/config/fixtures/replicas and separate warm-up, offered
load, completed journeys, rejections and successful-answer latency. Capture
hardware, cgroup limits, generator placement, dependency mode and background
workload. Do not compare mock and real provider timings as application regressions.
Use `results-template.md`; report bottlenecks only when supported by measurements.

CI adds one GitHub-hosted PR smoke workflow; existing self-hosted publish/deploy
workflows are unchanged. Actions and k6 archives are pinned; no AWS, payment,
Langfuse or deployment credentials are needed. Only tiny healthy-mock tests run
automatically. Docker/Minikube, ramp, soak and real-model tests are manual.
