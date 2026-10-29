import math
import re
from decimal import Decimal
from conversation import Clarification
from runtime import HttpError

# Words that say nothing about the product: never matched on their own.
STOP = set(
    "a an the for to me i want need find show robot robots droid please something under below less than euros euro with and of my is can you recommend what which those these them that it one ones two compare available cheaper cheapest cheap affordable more expensive the are "
    "help choose option options product products item items thing things stuff good best great nice suitable home house anything some any kind type looking look like would should could tell about how get buy use used using works work working support supports supported does do on in at by from this only just now today also really very get got have has show shows listed list price prices cost costs budget forget ignore instead never mind new search start over other else first second third last both top bots bot device devices machine machines all your you we our us gift present year years old who likes like loves love".split()
)
SYNONYMS = {
    "guard": ["security", "protection"],
    "guarding": ["security", "protection"],
    "protect": ["security", "protection"],
    "safety": ["security", "protection"],
    "medical": ["medical", "surgery"],
    "doctor": ["medical", "surgery"],
    "gardening": ["vegetation", "harvester", "lawn"],
    "mining": ["mining", "minerals"],
    "monitoring": ["observability"],
    "kids": ["children", "child", "education", "stem"],
    "kid": ["children", "child", "education", "stem"],
    "school": ["classroom", "education"],
    "coding": ["programming", "programmed", "education", "stem"],
    "mow": ["mower", "lawn"], "mowing": ["mower", "lawn"],
    "dog": ["pet"], "cat": ["pet"], "pet": ["dog", "cat"],
}


# Same two-decimal currencies accepted by commerce; no inferred FX conversion.
CODES = set('EUR USD INR GBP SGD AUD CAD NZD CHF CNY HKD CZK DKK HUF PLN RON NOK SEK TRY BRL MXN ZAR MYR PHP THB IDR ILS'.split())
SYMBOLS = {'₹':'INR','€':'EUR','£':'GBP','$':'USD','S$':'SGD','A$':'AUD','C$':'CAD','NZ$':'NZD','HK$':'HKD'}
CURRENCY = re.compile(r'(?<![A-Za-z])(?:' + '|'.join(sorted(CODES)) + r')(?![A-Za-z])|NZ\$|HK\$|[SAC]\$|[₹€£$¥]', re.I)
# Whole keywords only: "underwater" is not a budget.
BUDGET = re.compile(r'\b(?:under|below|less than|up to|max(?:imum)?|budget(?:\s+of)?)(?![A-Za-z])\s*', re.I)
AMOUNT = re.compile(r'(?P<prefix>[A-Za-z]{3}|NZ\$|HK\$|[SAC]\$|[₹€£$¥])?\s*(?P<amount>\d[\d, \u00a0\u202f]*(?:\.\d+)?)(?P<thousands>k(?![A-Za-z]))?', re.I)
NUMBER = re.compile(r'(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:\.\d{1,2})?')
# Currency words only next to an amount ("5000 rupees", "Rs. 500"); "pounds" may be a weight.
WORD_AMOUNTS = [(re.compile(r'\brs\.?\s*(?=\d)', re.I), 'INR '),
                (re.compile(r'(\d[\d,.]*k?)\s*(?:rupees?|rs\.?)(?![A-Za-z])', re.I), r'INR \1'),
                (re.compile(r'(\d[\d,.]*k?)\s*euros?(?![A-Za-z])', re.I), r'EUR \1')]
BUYABLE = re.compile(r'\b(?:in stock|available now|available to buy|(?:i )?can buy(?: now)?|buy (?:it )?now|ready to ship|purchasable|store offers? only|no reference(?: listings?)?)\b', re.I)
NOT_OFFERS = ('reference', 'on-request', 'illustrative')


def constraints(products, query):
    """Explicit budget/currency/availability; returns (budget, currency, lexical, buyable)."""
    for pattern, replacement in WORD_AMOUNTS:
        query = pattern.sub(replacement, query)
    buyable = bool(BUYABLE.search(query))
    query = BUYABLE.sub(' ', query)
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
        amount = Decimal(re.sub(r'[, \u00a0\u202f]', '', match['amount']))
        amounts.append(amount * 1000 if match['thousands'] else amount)
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
    return amounts[0] if amounts else None, currency if found or amounts else None, lexical, buyable


def singular(word):
    if len(word) > 4 and word.endswith('ies'):
        return word[:-3] + 'y'
    if len(word) > 4 and word.endswith('es') and word[-3] in 'sxz':
        return word[:-2]
    if len(word) > 3 and word.endswith('s') and not word.endswith('ss'):
        return word[:-1]
    return word


def same(a, b):
    """Whole-word match tolerant of plurals and suffixes (educational/education), never substrings."""
    a, b = singular(a), singular(b)
    if a == b:
        return True
    short, long = sorted((a, b), key=len)
    # Prefixes from four letters cover suffixes and compound names (lawn/LawnPilot, edu/EduBot excluded).
    return len(short) >= 4 and long.startswith(short) and (len(short) >= 5 or len(long) - len(short) >= 4)


def words(text):
    return re.findall('[a-z0-9]+', text.lower())


GENERIC_ROOTS = ("robot", "droid", "machine", "device")


def terms(lexical):
    """Content words of a request, in order, without generic words (incl. "robotic") or bare numbers."""
    return list(dict.fromkeys(w for w in words(lexical) if w not in STOP and not w.isdigit() and len(w) > 1
                              and not any(same(w, root) for root in GENERIC_ROOTS)))


def hit(term, vocabulary):
    return any(same(t, v) for t in [term] + SYNONYMS.get(term, []) for v in vocabulary)


def identity(p):
    return set(words(' '.join([p['name'], p.get('productType', ''), *p['categories']])))


def product_words(p):
    specs = p.get('specifications') if isinstance(p.get('specifications'), dict) else {}
    return set(words(' '.join([p['name'], p.get('productType', ''), p.get('manufacturer', ''), p.get('model', ''), p['description'],
                               *p['categories'], *p.get('compatibility', []), *p.get('useCases', []), *specs.keys(), *map(str, specs.values())])))


def analyse(products, query):
    """Parsed request: constraints plus product-type terms (hard) and feature terms (preferences)."""
    if not isinstance(query, str) or len(query) > 1000:
        raise HttpError(400, "Invalid search query.")
    budget, currency, lexical, buyable = constraints(products, query)
    content = terms(lexical)
    vocabulary = set().union(*(identity(p) for p in products)) if products else set()
    kinds = [t for t in content if hit(t, vocabulary)]
    return {"budget": budget, "currency": currency, "buyable": buyable, "types": kinds,
            "features": [t for t in content if t not in kinds], "constrained": budget is not None or currency is not None or buyable}


def retrieve(products, query, *, reference_skus=None):
    request = analyse(products, query)
    budget, currency, kinds, features = request["budget"], request["currency"], request["types"], request["features"]
    picks = []
    for p in products:
        if (
            (reference_skus is not None and p["sku"] not in reference_skus)
            or p.get("archived")
            or (currency is not None and p.get("currency", "EUR") != currency)
            or (p["instock"] <= 0 and p.get("collection") != "reference")
            or (request["buyable"] and (p["instock"] <= 0 or p.get("priceType") in NOT_OFFERS
                                        or p.get("collection") == "reference" or p.get("showcase")))
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
        vocabulary = product_words(p)
        # The requested product type is a hard requirement, also for follow-ups about earlier products.
        if not all(hit(t, vocabulary) for t in kinds):
            continue
        matched = [t for t in features if hit(t, vocabulary)]
        missing = [t for t in features if t not in matched]
        # Without a product type, most descriptive words must be present: one incidental word is not a match.
        if reference_skus is None and not kinds and len(matched) * 2 < len(features):
            continue
        if matched or kinds:
            reason = "Matches " + ", ".join((kinds + matched)[:4]) + " in the catalogue."
        elif budget is not None:
            reason = f"Within your {currency} {budget:g} budget."
        else:
            reason = "Reference listing, not sold here." if p.get("collection") == "reference" else "Catalogue pick; check inventory provenance."
        if missing:
            reason += " Not stated in the listing: " + ", ".join(missing) + "."
        if p.get("showcase"):
            reason += " Showcase only; availability is simulated."
        picks.append({**p, "score": len(kinds) + len(matched), "reason": reason, "missing": missing})
    # Explicit requirements win: when some listings satisfy all of them, drop partial matches.
    if reference_skus is None and features and any(not p["missing"] for p in picks):
        picks = [p for p in picks if not p["missing"]]
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
