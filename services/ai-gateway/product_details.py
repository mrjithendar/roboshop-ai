from runtime import HttpError


def related(current, products):
    def score(p):
        category = len(set(current["categories"]) & set(p["categories"]))
        use = len(set(current.get("useCases", [])) & set(p.get("useCases", [])))
        comparable = (
            current.get("currency", "EUR") == p.get("currency", "EUR")
            and current.get("priceType") != "on-request"
            and p.get("priceType") != "on-request"
        )
        return (
            -category,
            -use,
            0 if comparable else 1,
            abs(p["price"] - current["price"]) if comparable else 0,
            p["sku"],
        )

    return sorted(
        [
            p
            for p in products
            if p["sku"] != current["sku"] and not p.get("archived") and p["instock"] > 0
        ],
        key=score,
    )[:4]


def purchasable(p):
    return (
        not p.get("showcase")
        and not p.get("synthetic")
        and p.get("currency", "EUR") in ("EUR", "USD", "INR")
        and p.get("priceType", "sale") == "sale"
        and not p.get("archived")
    )


def require_purchasable(p):
    if not purchasable(p):
        raise HttpError(
            409,
            "This product is display-only. Showcase, synthetic, unsupported-currency and reference prices cannot enter live checkout.",
        )
