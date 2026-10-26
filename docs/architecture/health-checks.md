# Workload readiness and dependency diagnostics

Liveness is a local process check. It must not fail because a remote service,
model, database, or telemetry exporter is unavailable. Kubernetes startup probes
for the application workloads likewise check `/health`; readiness determines
whether a workload is suitable for traffic without restarting it.

| Workload | Readiness | Essential checks |
| --- | --- | --- |
| Gateway | `/api/ready` | MongoDB, catalogue `/api/catalogue/ready`, user-service `/api/users/ready`, cart `/ready` when configured, exclusive ledger writer still owned |
| NGINX | `/ready` | Gateway core readiness; no cookies, model checks, or aggregate SRE calls |
| Frontend | `/health` | Local static HTTP server; no API/model dependencies |
| Moks | `/ready` | Catalogue readiness; configuration and models are selected per request |
| Catalogue | `/api/catalogue/ready` | Its MongoDB connection |
| Cart | `/ready` | Its Redis connection |
| User service | `/api/users/ready` | Its MongoDB connection |
| Shipping | `/api/shipping/ready` | Its PostgreSQL schema and location-seed version |

Gateway readiness executes concurrent probes with a 1.5-second response budget,
one-second dependency I/O deadlines, and at most eight outstanding probes. It
returns HTTP 503 with named unavailable dependencies on failure or probe saturation.
It bypasses authentication/session lookup, so the probe cannot depend on a visitor
cookie or an unrelated model endpoint. File commits still remain local ledger work.

NGINX allows one second to connect and two seconds to read gateway readiness. Its
HTTP `/ready` does not redirect in TLS mode. The Moks widget probes two operator
URLs concurrently within 1.5 seconds, with at most three outstanding probes, and
caches the result for ten seconds. `/available` additionally reports visitor login
state; it is not a Kubernetes probe. Moks uses a one-second catalogue probe; catalogue-service probes MongoDB directly. Kubernetes probe deadlines exceed these budgets.

No readiness check invokes paid model inference, checks an external model's
semantic correctness, or waits for telemetry. A model can fail after readiness
succeeds: that request returns an explicit unavailable feature response. No provider
is configured in a fresh installation; Moks offers a setup notice when no LLM is configured.

## Failure isolation

Moks and telemetry outages do not change gateway or NGINX readiness.
Recommendation input/ranking errors remain request-scoped. A catalogue-service or
MongoDB outage now affects both catalogue reads and recommendations and fails core readiness. Catalogue/cart operations continue when their own core
requirements are healthy. Gateway requests for unavailable recommendations or AI
return HTTP 503 with `code: feature-unavailable`, a feature name, and no fabricated
results. Finder preserves the conversation and returns the same explicit failure
category. Payment and shipping keep their own validation/error handling; their
availability does not gate browsing or account administration.

When a core dependency fails, gateway readiness becomes 503 and Kubernetes removes
that gateway from ready endpoints. NGINX readiness follows it, while local `/health`
continues to return 200. Recovery restores readiness without restarting application
processes. NGINX can still serve static routes directly while its gateway is down,
but its Kubernetes Service stops sending it new traffic until core readiness returns.

## Aggregate diagnostics

Gateway `/api/ops` forwards SRE `/api/ops` using a three-second deadline. SRE probes
its configured service targets concurrently with two-second deadlines and returns
HTTP 200 with `status: healthy|degraded`, per-target status, latency, and core/feature
classification. Failure of SRE itself returns HTTP 503 `feature-unavailable` for
that diagnostic route only. Aggregate reports are **never** readiness gates.

The graph is acyclic: NGINX → gateway → core services; Finder → gateway status
and users (no self-probe); Moks → catalogue → MongoDB. SRE observes these leaf/scoped
checks but does not probe its own aggregate endpoint or gateway/NGINX readiness.
Neither the gateway nor any core service probes SRE for readiness. External model,
payment-provider and telemetry health needs its own operational monitoring; a
service's process response is not evidence that every downstream system works.

## LLM administration during outages

Saving direct-provider settings validates fields and atomically checks the MongoDB configuration
revision, without contacting a model or shopping agent. Disconnect also requires
no agent/model request, including when the optional Ollama allowlist is broken.
The save clears `verifiedAt`; it does not claim a successful connection. The
separate **Test connection** action performs a bounded model call and never
activates settings. Concurrent or unauthorized changes remain rejected.

Enabled Ollama-to-Bedrock failover policies are the exception to direct-provider
saves: both proposed providers must pass activation tests before commit. Disconnect
and direct-provider repairs remain available without model connectivity. Background
provider diagnostics never gate pod readiness. See [routing policy](../deployment/llm-providers.md).

## Checks

- Python gateway readiness tests exercise optional failures, each core dependency,
  recovery, liveness, probe budget, unaffected catalogue/cart routes, and manifests.
- Finder tests exercise backend failure/recovery and explicit model failures.
- Native NGINX tests check core-readiness failure/recovery alongside healthy local
  liveness and static routes, including the optional TLS listener.
- Node tests check catalogue/recommendation recovery and bounded SRE diagnostics.

Recommendations now run inside catalogue-service and use its MongoDB readiness.
`/ready` is a compatibility alias; no recommendation-to-catalogue HTTP probe remains.
