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