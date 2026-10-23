import math
import re
from decimal import Decimal
from conversation import Clarification
from runtime import HttpError

STOP = set(
    "a an the for to me i want need find show robot robots droid please something under below less than euros euro with and of my is can you recommend what which those these them that it one ones two compare available cheaper cheapest cheap affordable more expensive the are".split()
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


# Same two-decimal currencies accepted by commerce; no inferred FX conversion.
CODES = set('EUR USD INR GBP SGD AUD CAD NZD CHF CNY HKD CZK DKK HUF PLN RON NOK SEK TRY BRL MXN ZAR MYR PHP THB IDR ILS'.split())
SYMBOLS = {'₹':'INR','€':'EUR','£':'GBP','$':'USD','S$':'SGD','A$':'AUD','C$':'CAD','NZ$':'NZD','HK$':'HKD'}
CURRENCY = re.compile(r'(?<![A-Za-z])(?:' + '|'.join(sorted(CODES)) + r')(?![A-Za-z])|NZ\$|HK\$|[SAC]\$|[₹€£$¥]', re.I)
BUDGET = re.compile(r'\b(?:under|below|less than|up to|max(?:imum)?|budget(?:\s+of)?)\s*', re.I)
AMOUNT = re.compile(r'(?P<prefix>[A-Za-z]{3}|NZ\$|HK\$|[SAC]\$|[₹€£$¥])?\s*(?P<amount>\d[\d, \u00a0\u202f]*(?:\.\d+)?)', re.I)
NUMBER = re.compile(r'(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:\.\d{1,2})?')

def constraints(products, query):
    found = set()
    for match in CURRENCY.finditer(query):
        token = match.group().upper()
        if token == 'TRY' and match.group() != 'TRY' and not re.search(r'\d', query[max(0, match.start()-5):match.end()+5]):
            continue  # The ordinary English verb is not a currency constraint.
        if token == '¥':
            raise Clarification('Please specify the currency code for your budget.')
        found.add(SYMBOLS.get(token, token))
    if len(found) > 1:
        raise Clarification('Please choose one budget currency; I cannot compare amounts across currencies.')
    amounts, spans = [], []
    for start in BUDGET.finditer(query):
        match = AMOUNT.match(query, start.end())
        if not match or not NUMBER.fullmatch(match['amount'].strip()) or re.match(r'[.,-]\d', query[match.end():]):
            raise Clarification('Please specify a budget amount and currency, for example INR 500.')
        prefix = (match['prefix'] or '').upper()
        if prefix and prefix not in CODES and prefix not in SYMBOLS:
            raise Clarification('Please specify a supported currency code for your budget.')
        amounts.append(Decimal(re.sub(r'[, \u00a0\u202f]', '', match['amount'])))
        spans.append((start.start(), match.end()))
    if len(set(amounts)) > 1:
        raise Clarification('Please specify one maximum budget for this search.')
    currencies = {p.get('currency', 'EUR') for p in products if not p.get('archived')}
    currency = next(iter(found)) if found else next(iter(currencies)) if len(currencies) == 1 else None
    if amounts and currency is None:
        raise Clarification('Which currency should I use for your budget?')
    lexical = query
    for start, end in reversed(spans):
        lexical = lexical[:start] + ' ' + lexical[end:]
    lexical = CURRENCY.sub(' ', lexical)
    return amounts[0] if amounts else None, currency if found or amounts else None, lexical


def retrieve(products, query, *, reference_skus=None):
    if not isinstance(query, str) or len(query) > 1000:
        raise HttpError(400, "Invalid search query.")
    budget, currency, lexical = constraints(products, query)
    words = [
        w
        for w in re.findall("[a-z0-9]+", lexical.lower())
        if w not in STOP and not w.isdigit()
    ]
    terms = [t for w in words for t in [w] + SYNONYMS.get(w, [])]
    identity_words = {w for p in products for w in re.findall('[a-z0-9]+', ' '.join([p['name'], *p['categories']]).lower()) if w not in STOP}
    required = set(words) & identity_words
    picks = []
    for p in products:
        if (
            (reference_skus is not None and p["sku"] not in reference_skus)
            or p.get("archived")
            or (currency is not None and p.get("currency", "EUR") != currency)
            or (p["instock"] <= 0 and p.get("collection") != "reference")
            or (
                budget is not None
                and (
                    p.get("currency", "EUR") != currency
                    or p.get("priceType") == "on-request"
                    or Decimal(str(p["price"])) > budget
                )
            )
        ):
            continue
        haystack = " ".join([p["name"], p.get("manufacturer", ""), p.get("model", ""), p["description"], *p["categories"], *p.get("compatibility", []), *p.get("specifications", {}).values()]).lower()
        if required and not all(any(t in haystack for t in [w] + SYNONYMS.get(w, [])) for w in required):
            continue
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
            "instock": 0 if p.get("archived") else p["instock"],
            "archived": p.get("archived") is True,
            "image": f"/images/{p['sku']}.png",
        }
    except (KeyError, ValueError, TypeError):
        raise HttpError(
            400, "Enter a valid SKU, name, description, price, stock and categories."
        )
