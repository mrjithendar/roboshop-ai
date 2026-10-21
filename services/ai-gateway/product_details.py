from runtime import HttpError


def related(current, products):
    def score(p):
        category = len(set(current["categories"]) & set(p["categories"]))
        use = len(set(current.get("useCases", [])) & set(p.get("useCases", [])))
        comparable = (
            current.get("currency", "EUR") == p.get("currency", "EUR")
            and current.get("collection", "merchant") == p.get("collection", "merchant")
            and current.get("priceType", "sale") == p.get("priceType", "sale")
            and current.get("priceType") != "on-request"
            and p.get("priceType") != "on-request"
        )
        return (
            0 if current.get("collection", "merchant") == p.get("collection", "merchant") else 1,
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
            if p["sku"] != current["sku"] and not p.get("archived") and (p["instock"] > 0 or p.get("collection") == "reference")
        ],
        key=score,
    )[:4]


def purchasable(p):
    return (
        not p.get("unavailable")
        and p.get("collection") != "reference"
        and not p.get("sku", "").startswith("REF-")
        and not p.get("showcase")
        and (not p.get("synthetic") or p.get("demo") is True)
        and p.get("currency", "EUR") in ("EUR", "USD", "INR")
        and p.get("priceType", "sale") == "sale"
        and not p.get("archived")
    )


def require_purchasable(p):
    if p.get("unavailable"):
        raise HttpError(409, "Remove unavailable items from your cart before checking out.")
    if not purchasable(p):
        raise HttpError(
            409,
            "This product is display-only. Showcase, synthetic, unsupported-currency and reference prices cannot enter live checkout.",
        )


def demo_inventory(product):
    """Recognize the old concept seed even in databases not reseeded on upgrade."""
    return bool(product.get("demo") or product.get("synthetic")
                or product.get("showcase") or product.get("fulfilment") == "simulated"
                or product.get("catalogueVersion") in ("merchant-20-inr-v1", "demo-20-inr-v2"))


def checkout_provenance(items, mode):
    if mode not in ("test", "live"):
        raise HttpError(409, "A known payment environment is required.")
    inventory = [{"sku": p["sku"], "demo": demo_inventory(p),
                  "synthetic": bool(p.get("synthetic")),
                  "catalogueVersion": p.get("catalogueVersion"),
                  "fulfilment": p.get("fulfilment", "merchant")} for p in items]
    if mode == "live" and any(p["demo"] for p in inventory):
        raise HttpError(409, "Demo inventory requires Razorpay Test Mode. Live payment is blocked.")
    return {"demo": mode == "test" or any(p["demo"] for p in inventory),
            "synthetic": any(p["synthetic"] for p in inventory),
            "inventoryProvenance": "demo" if any(p["demo"] for p in inventory) else "merchant",
            "productProvenance": inventory}
