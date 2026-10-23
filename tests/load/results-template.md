# Load-test report

- Commit / date / run ID:
- Scenario and exact command:
- Target allowlist and synthetic-data confirmation (no credentials):
- Generator OS/architecture/CPU/RAM, separate or colocated:
- Application image versions, replica counts and resource limits:
- Storage backends and dataset size:
- Mock or real provider, configured latency/errors, model and maximum attempts:
- Warm-up duration, measurement duration, VUs, offered arrival rate:
- Threshold overrides and rationale:

| Operation | Count | p50 ms | p95 ms | p99 ms | max ms | unexpected failures | admission rejections |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fill from summary.json | | | | | | | |

- Completed journeys/s and successful operations/s:
- Offered vs achieved rate; dropped iterations:
- AI accepted requests vs successful answers, successful-answer latency:
- Clarification/not-configured/timeout/provider-unavailable outcomes:
- Correctness: isolation, stock, idempotency, payment replay:
- Durable verification errors and number of logical orders:
- Resource saturation/restarts and relevant trace IDs:
- Available token usage / costs (or unavailable):
- Failed, skipped, blocked checks:
- Suspected bottleneck and evidence; uncertainty:
- Cleanup completed and retained sanitized artifacts:

Do not derive production capacity from the default JSON/MongoMock lab. Tiny smoke
runs have too few samples for meaningful tail-latency estimates. Keep failed runs
in the report; separate intended fault experiments from healthy-capacity gates.
