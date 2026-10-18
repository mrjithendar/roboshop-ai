import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [
    str(root / "services/python-common"),
    str(root / "services/shopping-agent"),
]
from agent import answer
from catalogue import retrieve

products = json.loads((root / "services/product-ingestion/products.json").read_text())
count = 0
for case in json.loads((root / "evaluations/rag/cases.json").read_text()):
    picks = retrieve(products, case["query"])
    assert (picks[0]["sku"] if picks else None) == case["expectedSku"], case["query"]
    assert all(
        p["instock"] > 0 and p["price"] <= case.get("budget", float("inf"))
        for p in picks
    )
    count += 1
for case in json.loads((root / "evaluations/security/cases.json").read_text()):
    result = answer(products, case["query"], api_key="", model="")
    assert result["mode"] == "catalogue-search" and "<script>" not in result["answer"]
    assert all(any(s["sku"] == p["sku"] for s in products) for p in result["products"])
    count += 1
print(
    f"{count} deterministic retrieval/security evaluations passed. Live-model injection resistance is not evaluated."
)
