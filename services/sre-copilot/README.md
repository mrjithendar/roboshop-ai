# SRE copilot

Port 4104, GET `/api/ops`. Probes configured core and optional service health
concurrently with two-second timeouts. Returns availability, probe latency, timestamp,
and deterministic runbook suggestions. It never executes commands or changes
infrastructure. Health probes measure availability, not end-to-end correctness or
root cause. This service is explicitly a read-only runbook assistant, not LLM diagnosis.

## Independent service build

Run `docker build -t robotshop-sre-copilot:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).


`/health` and `/ready` check only the diagnostic process. `/api/ops` returns HTTP
200 with `status: healthy|degraded` and each target's core/feature classification.
Targets are probed concurrently with two-second deadlines. The aggregate report
never controls storefront readiness; it does not probe itself or gateway/NGINX
readiness. Failure to reach SRE produces a feature-unavailable diagnostic response
at the gateway, without changing gateway readiness. These probes do not execute
model inference or verify every external payment/model/telemetry system.
