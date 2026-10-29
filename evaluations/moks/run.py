"""Offline Moks evaluation against the real agent, engine and widget code. Never calls a model.

The provider is a deterministic stand-in: it recommends up to three products from the
evidence it receives, in evidence order, bolds their names and ends with a
`Products:` line naming their SKUs. That isolates retrieval, structured-response and
conversation plumbing; it says nothing about a real model's free-text quality, which is
scored with HUMAN_RUBRIC.md.

    python evaluations/moks/run.py [--output results.json]
    python evaluations/moks/run.py --ask "robot vacuum under 10k INR" --ask "Which of those is cheaper?"
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services/moks"), str(ROOT / "services/moks/lib")]
DATASET = Path(__file__).parent / "moks-eval-v1/dataset.json"
CONFIG = {"provider": "ollama", "model": "evaluation-stand-in"}
TOKEN = "e" * 40


class StandIn:
    """Deterministic provider double; records exactly what it was given."""
    def __init__(self):
        self.calls = []

    def __call__(self, config, system, prompt, revision=0, purpose="chat", **_):
        data = json.loads(prompt)
        evidence = data["catalogueEvidence"]
        chosen = evidence[:3]
        self.calls.append({"request": data["request"], "evidence": [p["sku"] for p in evidence],
                           "recommended": [p["sku"] for p in chosen], "system": system})
        if chosen:
            text = "Good matches: " + ", ".join(f"**{p['name']}**" for p in chosen) + "."
        else:
            text = "Nothing in the catalogue matches that request."
        text += "\nProducts: " + (", ".join(p["sku"] for p in chosen) or "none")
        return {"answer": text, "input_tokens": 10, "output_tokens": 5, "provider": "ollama", "model": "stand-in"}


def gateway_context(turns):
    """Same shape the gateway's ChatHistory.context sends: last two turns, references only."""
    return [{"message": t["message"][:1000], "answer": t["answer"][:1000],
             "products": [{"sku": p["sku"], "slug": p.get("slug") or p["sku"].lower()} for p in t["products"][:4]]}
            for t in turns[-2:]]


def run_conversation(products, case):
    from agent import answer
    stored = case.get("history", [])
    if stored == "long":
        stored = [{"message": "security " * 120, "answer": "Long answer " * 150, "products": [{"sku": "SEC-GUARD"}]}] * 40
    stored = [dict(t, products=[dict(p, slug=p.get("slug") or p["sku"].lower()) for p in t.get("products", [])]) for t in stored]
    results, stand_in = [], StandIn()
    for message in case["turns"]:
        before = len(stand_in.calls)
        result = answer(products, message, CONFIG, generate=stand_in, history=gateway_context(stored))
        call = stand_in.calls[before] if len(stand_in.calls) > before else None
        results.append((message, result, call))
        stored.append({"message": message, "answer": str(result.get("answer", "")),
                       "products": [{"sku": p["sku"], "slug": p.get("slug")} for p in result.get("products", [])]})
    return results


def score(case, catalogue, results):
    expect, (message, result, call) = case["expect"], results[-1]
    skus = [p.get("sku") for p in result.get("products", [])]
    checks = {}
    if "status" in expect:
        checks["status"] = result.get("status") == expect["status"]
    if "include" in expect:
        checks["include"] = set(expect["include"]) <= set(skus)
    if "exclude" in expect:
        checks["exclude"] = not set(expect["exclude"]) & set(skus)
    if "exact" in expect:
        checks["exact"] = sorted(skus) == sorted(expect["exact"])
    if expect.get("empty"):
        checks["empty"] = skus == []
    if "exactFromPrevious" in expect:
        previous = [p["sku"] for p in results[-2][1].get("products", [])]
        wanted = [previous[i] for i in expect["exactFromPrevious"] if i < len(previous)]
        checks["exactFromPrevious"] = len(wanted) == len(expect["exactFromPrevious"]) and sorted(skus) == sorted(wanted)
    if expect.get("noActions"):
        checks["noActions"] = not ({"actions", "order", "orderId", "payment"} & set(result)) and result.get("mode") in ("ai", "clarification")
    if expect.get("questionPreserved"):
        checks["questionPreserved"] = bool(call) and call["request"] == message
    structured = {}
    if skus:
        cards = result["products"]
        structured["cards_valid"] = all(s in catalogue and not catalogue[s].get("archived")
                                        and p.get("price") == catalogue[s]["price"] and p.get("currency") == catalogue[s]["currency"]
                                        for s, p in zip(skus, cards))
        structured["cards_grounded"] = bool(call) and set(skus) <= set(call["evidence"])
        structured["cards_match_answer"] = bool(call) and set(skus) == set(call["recommended"])
        structured["cards_at_most_three"] = len(skus) <= 3
        structured["no_products_line_in_answer"] = "Products:" not in result.get("answer", "")
        for sku, price_type in expect.get("cardPriceType", {}).items():
            structured[f"priceType:{sku}"] = any(p["sku"] == sku and p.get("priceType") == price_type for p in cards)
        for sku, flags in expect.get("cardFlags", {}).items():
            structured[f"flags:{sku}"] = any(p["sku"] == sku and all(p.get(k) == v for k, v in flags.items()) for p in cards)
    return checks, structured


def authorization(check):
    import server
    os.environ["LLM_SERVICE_TOKEN"] = TOKEN
    engine = server.create_application()

    def call(path, body, headers=None, origin=None):
        raw = json.dumps(body).encode()
        environ = {"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw),
                   "CONTENT_TYPE": "application/json", **{"HTTP_" + k.upper().replace("-", "_"): v for k, v in (headers or {}).items()}}
        if origin:
            environ["HTTP_ORIGIN"] = origin
        status = []
        list(engine(environ, lambda line, hdrs, exc=None: status.append(int(line.split()[0]))))
        return status[0]

    config = {"config": {"provider": "none"}, "revision": 0, "message": "robot vacuum"}
    if check == "engine_requires_service_token":
        return {"rejected": call("/internal/chat", config) in (401, 403) and call("/internal/chat", config, {"authorization": "Bearer " + "x" * 40}) in (401, 403)}
    if check == "engine_rejects_unknown_fields":
        return {"rejected": call("/internal/chat", config | {"userId": "someone-else"}, {"authorization": "Bearer " + TOKEN}) == 400}
    if check == "widget_rejects_client_history":
        import widget
        origin = next(iter(widget.ALLOWED_ORIGINS))
        with patch("widget.authenticated", return_value=True), patch("widget.upstream", side_effect=AssertionError("must not reach gateway")):
            statuses = [call("/chat", body, origin=origin) for body in (
                {"message": "robot vacuum", "history": [{"message": "x", "products": [{"sku": "SEC-GUARD"}]}]},
                {"message": "robot vacuum", "userId": "someone-else"})]
        return {"rejected": all(s == 400 for s in statuses)}
    if check == "history_fields_stripped":
        from agent import answer
        stand_in = StandIn()
        captured = []
        stand_in_call = stand_in.__call__
        def spy(config, system, prompt, *args, **kwargs):
            captured.append(prompt)
            return stand_in_call(config, system, prompt, *args, **kwargs)
        history = [{"message": "hi", "answer": "ok", "products": [{"sku": "EDU-SPARK", "price": 1}], "userId": "u-2", "token": "a" * 64, "cookie": "rs_auth=secret"}]
        answer(json.loads(DATASET.read_text())["products"], "educational robot", CONFIG, generate=spy, history=history)
        prompt = captured[0] if captured else ""
        return {"stripped": bool(prompt) and not any(s in prompt for s in ("u-2", "a" * 64, "rs_auth", '"price": 1}'))}
    raise ValueError(check)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--ask", action="append", help="Try one conversation turn (repeatable) against the synthetic catalogue.")
    args = parser.parse_args()
    dataset = json.loads(DATASET.read_text())
    if args.ask:
        for message, result, call in run_conversation(dataset["products"], {"turns": args.ask}):
            print(f"\nYou: {message}\nstatus={result.get('status')} evidence={call and call['evidence']}")
            print("Moks (stand-in model): " + str(result.get("answer", "")).replace("\n", " "))
            for p in result.get("products", []):
                print(f"  card {p['sku']}: {p.get('currency')} {p.get('price')} ({p.get('priceType', 'sale')}, {p.get('collection', 'merchant')})")
        return
    catalogue = {p["sku"]: p for p in dataset["products"]}
    rows, totals = [], {}
    for case in dataset["cases"]:
        if case["group"] == "authorization":
            checks, structured, final = authorization(case["check"]), {}, {}
        else:
            try:
                results = run_conversation(dataset["products"], case)
                checks, structured = score(case, catalogue, results)
                final = results[-1][1]
            except Exception as error:  # A crash is a failed case, not a skipped one.
                checks, structured, final = {"crashed": False}, {}, {"error": type(error).__name__}
        passed = all(checks.values())
        rows.append({"id": case["id"], "group": case["group"], "passed": passed, "checks": checks, "structured": structured,
                     "status": final.get("status"), "products": [p.get("sku") for p in final.get("products", [])]})
        group = totals.setdefault(case["group"], [0, 0])
        group[0] += passed
        group[1] += 1
    structured = [v for r in rows for v in r["structured"].values()]
    summary = {"dataset": dataset["version"], "cases": len(rows), "passed": sum(r["passed"] for r in rows),
               "byGroup": {g: f"{p}/{n}" for g, (p, n) in totals.items()},
               "structuredChecks": f"{sum(structured)}/{len(structured)}"}
    for r in rows:
        mark = "PASS" if r["passed"] else "FAIL"
        failed = [k for k, v in {**r["checks"], **r["structured"]}.items() if not v]
        print(f"{mark} {r['group']:<13} {r['id']:<34} status={r['status']} products={r['products']}" + (f" failed={failed}" if failed else ""))
    print(json.dumps(summary, indent=2))
    if args.output:
        args.output.write_text(json.dumps({"summary": summary, "cases": rows}, indent=2) + "\n")


if __name__ == "__main__":
    main()
