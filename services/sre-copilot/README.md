# SRE copilot

Port 4104, GET `/api/ops`. Probes catalogue, recommendation and shopping-agent health
concurrently with two-second timeouts. Returns availability, probe latency, timestamp,
and deterministic runbook suggestions. It never executes commands or changes
infrastructure. Health probes measure availability, not end-to-end correctness or
root cause. This service is explicitly a read-only runbook assistant, not LLM diagnosis.

## Independent service build

Run `docker build -t robotshop-sre-copilot:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
