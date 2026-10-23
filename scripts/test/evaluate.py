#!/usr/bin/env python3
import json
import sys
from pathlib import Path

if '--help' in sys.argv:
    print('Usage: python scripts/test/evaluate.py; requires Moks dependencies; runs local fixture evaluations, no deployment.')
    raise SystemExit(0)

root = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(root / "services/moks/lib"),
    str(root / "services/moks"),
]
from agent import answer
from catalogue import retrieve

products = json.loads(
    (root / "tests/fixtures/catalogue/fictional-products.json").read_text()
)
count = 0
for case in json.loads((root / "evaluation/rag/cases.json").read_text()):
    picks = retrieve(products, case["query"])
    assert (picks[0]["sku"] if picks else None) == case["expectedSku"], case["query"]
    assert all(
        p["instock"] > 0 and p["price"] <= case.get("budget", float("inf"))
        for p in picks
    )
    count += 1
for case in json.loads((root / "evaluation/security/cases.json").read_text()):
    result = answer(products, case["query"])
    assert result["mode"] == "not-configured" and "<script>" not in result["answer"]
    assert all(any(s["sku"] == p["sku"] for s in products) for p in result["products"])
    count += 1
print(
    f"{count} deterministic retrieval/security evaluations passed. Live-model injection resistance is not evaluated."
)
