import math
import re
from runtime import HttpError

STOP = set(
    "a an the for to me i want need find show robot robots droid please something under below less than euros euro with and of my is can you recommend".split()
)
SYNONYMS = {
    "guard": ["security", "protection"],
    "guarding": ["security", "protection"],
    "protect": ["security", "protection"],
    "safety": ["security", "protection"],
    "medical": ["medical", "surgery"],
    "doctor": ["medical", "surgery"],
    "gardening": ["vegetation", "harvester"],
    "mining": ["mining", "minerals"],
    "monitoring": ["observability"],
}


def retrieve(products, query):
    if not isinstance(query, str) or len(query) > 1000:
        raise HttpError(400, "Invalid search query.")
    match = re.search(
        r"(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?)\s*[€$]?\s*([\d,]+(?:\.\d{1,2})?)",
        query,
        re.I,
    )
    budget = float(match[1].replace(",", "")) if match else None
    words = [
        w
        for w in re.findall("[a-z0-9]+", query.lower())
        if w not in STOP and not w.isdigit()
    ]
    terms = [t for w in words for t in [w] + SYNONYMS.get(w, [])]
    picks = []
    for p in products:
        if (
            p.get("archived")
            or p["instock"] <= 0
            or (budget is not None and p["price"] > budget)
        ):
            continue
        haystack = " ".join([p["name"], p["description"], *p["categories"]]).lower()
        matches = [t for t in terms if t in haystack]
        if (
            terms
            and not all(w in ("cheap", "affordable", "budget") for w in words)
            and not matches
        ):
            continue
        reason = (
            f"In stock and within your €{budget:g} budget."
            if budget is not None
            else "In-stock catalogue pick."
        )
        if matches:
            reason = (
                "Matches "
                + ", ".join(list(dict.fromkeys(matches))[:3])
                + " in the catalogue."
            )
        picks.append({**p, "score": len(matches), "reason": reason})
    return sorted(picks, key=lambda p: (-p["score"], p["price"], p["sku"]))[:4]


def normalize(p):
    try:
        if (
            not isinstance(p["sku"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", p["sku"])
            or p["sku"] in ("__proto__", "constructor", "prototype")
        ):
            raise ValueError()
        if (
            not isinstance(p["name"], str)
            or not p["name"].strip()
            or len(p["name"]) > 200
            or not isinstance(p["description"], str)
            or len(p["description"]) > 3000
        ):
            raise ValueError()
        if (
            type(p["price"]) not in (int, float)
            or not math.isfinite(p["price"])
            or not 0 <= p["price"] <= 1000000
            or type(p["instock"]) is not int
            or p["instock"] < 0
        ):
            raise ValueError()
        if (
            not isinstance(p["categories"], list)
            or not p["categories"]
            or any(not isinstance(c, str) or len(c) > 100 for c in p["categories"])
        ):
            raise ValueError()
        return {k: p[k] for k in ("sku", "description", "categories")} | {
            "name": p["name"].strip(),
            "price": math.floor(p["price"] * 100 + 0.5) / 100,
            "instock": 0 if p.get("archived") else p["instock"],
            "archived": p.get("archived") is True,
            "image": f"/images/{p['sku']}.png",
        }
    except (KeyError, ValueError, TypeError):
        raise HttpError(
            400, "Enter a valid SKU, name, description, price, stock and categories."
        )
