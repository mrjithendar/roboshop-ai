import math
import re
from runtime import HttpError, UserError

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
        r"(?:under|below|less than|up to|max(?:imum)?|budget(?: of)?)\s*[€$₹]?\s*([\d,]+(?:\.\d{1,2})?)",
        query,
        re.I,
    )
    currencies = {p.get("currency", "EUR") for p in products if not p.get("archived")}
    currency = (
        "USD"
        if "$" in query or re.search(r"\bUSD\b", query, re.I)
        else "INR" if "₹" in query or re.search(r"\bINR\b", query, re.I) else "EUR" if "€" in query or re.search(r"\bEUR\b", query, re.I) else next(iter(currencies)) if len(currencies) == 1 else "EUR"
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
            or (p["instock"] <= 0 and p.get("collection") != "reference")
            or (
                budget is not None
                and (
                    p.get("currency", "EUR") != currency
                    or p.get("priceType") == "on-request"
                    or p["price"] > budget
                )
            )
        ):
            continue
        haystack = " ".join([p["name"], p.get("manufacturer", ""), p.get("model", ""), p["description"], *p["categories"], *p.get("compatibility", []), *p.get("specifications", {}).values()]).lower()
        matches = [t for t in terms if t in haystack]
        if (
            terms
            and not all(w in ("cheap", "affordable", "budget") for w in words)
            and not matches
        ):
            continue
        reason = (
            f"Catalogue reference within your {currency} {budget:g} budget."
            if budget is not None
            else "Reference listing, not sold here." if p.get("collection") == "reference" else "Catalogue pick; check inventory provenance."
        )
        if matches:
            reason = (
                "Matches "
                + ", ".join(list(dict.fromkeys(matches))[:3])
                + " in the catalogue."
            )
        if p.get("showcase"):
            reason += " Showcase only; availability is simulated."
        picks.append({**p, "score": len(matches), "reason": reason})
    return sorted(
        picks,
        key=lambda p: (
            -p["score"],
            p.get("currency", "EUR"),
            p.get("priceType") == "on-request",
            p.get("priceType", "sale"),
            p["price"],
            p["sku"],
        ),
    )[:4]


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
            "instock": p["instock"],
            "archived": p.get("archived") is True,
            "image": f"/images/{p['sku']}.png",
        }
    except (KeyError, ValueError, TypeError):
        raise UserError(
            400, "Enter a valid SKU, name, description, price, stock and categories."
        )
