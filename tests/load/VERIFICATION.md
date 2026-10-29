# Local verification — 2026-10-23

Environment: macOS ARM64, Python 3.11 isolated environment using the declared
service dependencies, Node 26, checksum-verified k6 1.3.0. No deployed endpoint,
paid model, real payment or infrastructure was used.

| Check | Result |
|---|---|
| Moks unit/regression suite | 48 passed |
| Gateway suite | 25 passed |
| Shared Python suite | 127 passed, 14 skipped (isolated MongoDB not configured) |
| Agent evaluations | 6 passed |
| Load guards/protocol tests | 4 passed |
| actionlint new workflow | passed |
| YAML parsing and git diff whitespace | passed |

Final k6 runs used two VUs, two-second scheduling windows, one-second warm-up
and one-second pacing. Each had four completed journeys, all configured
thresholds passing and no durable verification errors:

- browse, session, cart: passed;
- checkout: four logical test orders;
- idempotency: four logical test orders despite concurrent replays and repeated callbacks;
- limited-stock: three orders for three available units; the fourth journey was rejected;
- chat and isolation: four successful two-turn journeys each.

Earlier chat/isolation smoke attempts failed because the harness expected a
`status` field the widget intentionally omits; accelerated pacing also hit the
existing rate limit. The success predicate was corrected to the actual widget
contract and the final paced runs above passed. Those failures were not service
fixes or evidence of production performance.

These tiny samples validate the harness, not statistically meaningful capacity
or tail-latency SLOs. JSON/MongoMock and fixture catalogue/shipping responses do
not measure production databases. Docker build was blocked by the unavailable
local Docker daemon; Minikube, hosted CI, ramp/soak, explicit rate-limit profile,
arrival profile and opt-in real inference were not executed.

Reproduce application checks from the repository root using the isolated Python
from the README:

```bash
PY=tests/load/.venv/bin/python
"$PY" -m unittest discover -s services/moks/tests
"$PY" -m unittest discover -s services/ai-gateway/tests
"$PY" -m unittest discover -s tests/python
"$PY" -m unittest discover -s tests/load -p 'test_*.py'
for scenario in browse session cart checkout idempotency chat isolation limited-stock; do
  WARMUP_SECONDS=1 PACE_SECONDS=1 "$PY" tests/load/lab.py run \
    --run-id "load-check-${scenario}" --scenario "$scenario" --seconds 2 --vus 2 \
    --k6 tests/load/.tools/k6
  "$PY" tests/load/lab.py cleanup --run-id "load-check-${scenario}"
done
```

Use new run IDs or scoped cleanup before repeating. The existing MongoDB tests
remain skipped unless supplied with a dedicated disposable test database.
