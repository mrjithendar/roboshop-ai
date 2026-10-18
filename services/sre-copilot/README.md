# SRE copilot

Port 4104, GET `/api/ops`. Probes catalogue, recommendation and shopping-agent health
concurrently with two-second timeouts. Returns availability, probe latency, timestamp,
and deterministic runbook suggestions. It never executes commands or changes
infrastructure. Health probes measure availability, not end-to-end correctness or
root cause. This service is explicitly a read-only runbook assistant, not LLM diagnosis.
