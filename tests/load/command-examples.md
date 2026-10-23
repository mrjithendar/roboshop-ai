# Historical command examples

Review each command before use. This is not an executable workflow.

```bash
python3 -m venv tests/load/.venv
tests/load/.venv/bin/pip install -r tests/load/requirements.txt
tests/load/.venv/bin/python tests/load/install-k6.py

tests/load/.venv/bin/python tests/load/lab.py run --scenario browse --seconds 2 --vus 1 \
  --k6 tests/load/.tools/k6

# test mocked checkout and duplicate-request handling:
tests/load/.venv/bin/python tests/load/lab.py run --scenario idempotency --seconds 5 --vus 2 \
  --k6 tests/load/.tools/k6

PACE_SECONDS=5 tests/load/.venv/bin/python tests/load/lab.py run \
  --scenario idempotency --seconds 60 --vus 2 --k6 tests/load/.tools/k6

# Use the ramp profile to increase load gradually: 10 → 20 → 50 simulated users, then decrease.
tests/load/.venv/bin/python tests/load/lab.py run \
  --scenario browse --profile ramp --k6 tests/load/.tools/k6

# steady load of 20 users for 5 minutes:
tests/load/.venv/bin/python tests/load/lab.py run --scenario browse --seconds 120 --vus 20 \
  --k6 tests/load/.tools/k6

# Inspect summary.json in the printed results directory for:
# - p95/p99 latency: how slowly the slower requests completed.
# - Unexpected failures: application errors.
# - Admission rejections: requests blocked by rate/concurrency limits.
# - Completed journeys: work successfully completed.

# test website
python3 tests/load/website.py --confirm-live

# Multiple loads — 2 → 5 → 10 visitors, 30 seconds each:
python3 tests/load/website.py --confirm-live --users 2,5,10 --seconds 30

# Custom load with slower pacing:
python3 tests/load/website.py --confirm-live --users 10 --seconds 60 --interval 2
```
