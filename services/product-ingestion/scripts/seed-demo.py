#!/usr/bin/env python3
"""Explicit deterministic demo-only MongoDB seeder. No commerce/provider imports."""
import argparse
import hashlib
import gzip
import json
import os
from pathlib import Path
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient, UpdateOne
from pymongo.errors import DuplicateKeyError

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2"
GENERATED = datetime(2026, 10, 19, tzinfo=timezone.utc)


def guard(name):
    if os.getenv("APP_ENV") != "demo" or not re.fullmatch(
        r"robotshop_demo_[a-z0-9_]{1,40}", name
    ):
        raise ValueError(
            "Refusing: APP_ENV=demo and an isolated robotshop_demo_<name> database are required."
        )
    if any(
        os.getenv(k, "").lower() in ("prod", "production", "live")
        for k in ("NODE_ENV", "DEPLOYMENT_ENVIRONMENT", "ENVIRONMENT")
    ):
        raise ValueError("Refusing to seed or clean production.")
    if name == os.getenv("MONGODB_DATABASE", "robotshop"):
        raise ValueError(
            "Demo target must differ from the configured application database. Use a separate seeding process."
        )


def ident(dataset):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", dataset):
        raise ValueError(
            "Dataset ID must be 1–40 lowercase letters, digits, underscores or hyphens."
        )


def seed(
    db,
    dataset,
    products,
    *,
    customers=1000,
    reviews=3000,
    buyers=0.6,
    random_seed=42,
    small_test=False,
    writer=None,
):
    guard(db.name)
    ident(dataset)
    if customers not in (1000, 10000) and not small_test:
        raise ValueError(
            "Choose 1,000 or 10,000 synthetic profiles. Small sizes are only for automated tests."
        )
    if (
        not 1 <= customers <= 10000
        or not 0 <= reviews <= customers * len(products)
        or not 0 <= buyers <= 1
    ):
        raise ValueError("Invalid dataset sizes or purchase fraction.")
    if not products:
        raise ValueError("A reference catalogue is required.")
    fingerprint = hashlib.sha256(
        json.dumps(products, sort_keys=True).encode()
    ).hexdigest()
    config = dict(
        customers=customers,
        reviews=reviews,
        buyers=buyers,
        randomSeed=random_seed,
        catalogueHash=fingerprint,
        seedVersion=VERSION,
    )
    marker = dict(
        synthetic=True, datasetId=dataset, seedVersion=VERSION, generatedAt=GENERATED
    )
    if writer is None:
        db.demo_datasets.update_one(
            {"_id": dataset}, {"$setOnInsert": {**marker, "config": config}}, upsert=True
        )
        manifest = db.demo_datasets.find_one({"_id": dataset})
        if manifest.get("config") != config or not manifest.get("synthetic"):
            raise ValueError(
                "Dataset configuration changed. Use a new dataset ID or explicitly clean this dataset first."
            )
        db.demo_profiles.create_index([("datasetId", 1), ("_id", 1)])
        db.demo_profiles.create_index("email", unique=True)
        db.demo_purchases.create_index([("datasetId", 1), ("userId", 1), ("createdAt", -1)])
        db.reviews.create_index([("productId", 1), ("authorId", 1)], unique=True)
        db.reviews.create_index(
            [("productId", 1), ("status", 1), ("synthetic", 1), ("_id", 1)]
        )
        db.reviews.create_index([("synthetic", 1), ("datasetId", 1)])
        # Product catalogue is reference material, not a generated customer record. Never overwrite merchant rows.
        for product in products:
            existing = db.products.find_one({"_id": product["sku"]})
            if existing and existing.get("sku") != product["sku"]:
                raise ValueError("Conflicting non-showcase product in demo database.")
            db.products.update_one(
                {"_id": product["sku"]},
                {"$setOnInsert": {**product, "revision": 1}},
                upsert=True,
            )
    pending = {name: [] for name in ("demo_profiles", "demo_purchases", "reviews")}

    counts = {name:0 for name in pending}

    def queue(collection, row):
        if writer is not None:
            writer(collection, row)
            counts[collection] += 1
            return
        # Marker predicates ensure a collision with a genuine record raises duplicate key, never overwrites it.
        pending[collection].append(
            UpdateOne(
                {"_id": row["_id"], "synthetic": True, "datasetId": dataset},
                {"$setOnInsert": row},
                upsert=True,
            )
        )
        if len(pending[collection]) >= 250:
            flush(collection)

    def flush(collection):
        if pending[collection]:
            db[collection].bulk_write(pending[collection], ordered=True)
            pending[collection].clear()

    with (ROOT / 'data/countries.json').open() as locations:
        all_countries = json.load(locations)
        priority = {'IN','US','DE','FR','JP','BR','GB','AU','CA','ZA'}
        countries = sorted(all_countries, key=lambda row: (row[0] not in priority, row[0]))[:200]
    if len(countries) != 200:
        raise ValueError('The demo dataset requires 200 country/territory codes.')
    topics = [
        "assembly practice",
        "motion-control exercises",
        "sensor experiments",
        "classroom planning",
        "robotics software practice",
        "interface exploration",
    ]
    for i in range(customers):
        rng = random.Random(f"{random_seed}:{dataset}:{i}")
        uid = f"{dataset}:customer:{i:05d}"
        country, country_name = countries[i % len(countries)]
        language = 'en'
        created = GENERATED - timedelta(days=rng.randint(90, 1095))
        nreviews = reviews // customers + int(i < reviews % customers)
        choices = rng.sample(products, nreviews)
        purchasing = rng.random() < buyers
        queue(
            "demo_profiles",
            {
                **marker,
                "_id": uid,
                "name": f"Synthetic Customer {i + 1:05d}",
                "email": f"{dataset}.{i:05d}@example.com",
                "role": "customer",
                "authenticationDisabled": True,
                "createdAt": created,
                "country": country,
                "countryName": country_name,
                "languagePreference": language,
                "preferredCategories": sorted(
                    {p["categories"][0] for p in choices[:2]}
                ),
            },
        )
        for j, product in enumerate(
            choices if choices else ([rng.choice(products)] if purchasing else [])
        ):
            purchased_at = created + timedelta(
                days=rng.randint(1, max(1, (GENERATED - created).days - 30))
            )
            oid = f"{dataset}:order:{i:05d}:{j:02d}"
            status = rng.choices(
                ["delivered", "shipped", "processing", "cancelled"], [70, 15, 10, 5]
            )[0]
            if purchasing:
                quantity = rng.randint(1, 3)
                # These prices are deliberately illustrative, in their own EUR demo economy.
                unit = (
                    1000
                    + int(hashlib.sha256(product["sku"].encode()).hexdigest()[:6], 16)
                    % 99001
                )
                queue(
                    "demo_purchases",
                    {
                        **marker,
                        "_id": oid,
                        "userId": uid,
                        "createdAt": purchased_at,
                        "status": status,
                        "currency": "EUR",
                        "priceType": "illustrative",
                        "paymentCaptured": False,
                        "fulfilment": "simulated",
                        "items": [
                            {
                                "sku": product["sku"],
                                "quantity": quantity,
                                "unitPriceMinor": unit,
                                "lineTotalMinor": unit * quantity,
                            }
                        ],
                        "subtotalMinor": unit * quantity,
                        "shippingMinor": 0,
                        "totalMinor": unit * quantity,
                    },
                )
            if j < nreviews:
                rating = rng.choices([1, 2, 3, 4, 5], [8, 12, 25, 35, 20])[0]
                review_at = purchased_at + timedelta(days=rng.randint(1, 20))
                queue(
                    "reviews",
                    {
                        **marker,
                        "_id": f"{dataset}:review:{i:05d}:{j:02d}",
                        "productId": product["sku"],
                        "authorId": uid,
                        "rating": rating,
                        "title": f"Synthetic example: {rng.choice(topics)}",
                        "body": f"SYNTHETIC DEMO REVIEW. Example {i + 1}-{j + 1} assigns {rating}/5 for a simulated {rng.choice(topics)} scenario. This generated text is not a customer experience or product endorsement.",
                        "createdAt": review_at,
                        "updatedAt": review_at,
                        "status": "published",
                        "demoPurchaseId": (
                            oid if purchasing and status == "delivered" else None
                        ),
                    },
                )
    if writer is not None:
        return counts
    for collection in pending:
        flush(collection)
    db.demo_datasets.update_one(
        {"_id": dataset, "synthetic": True}, {"$set": {"complete": True}}
    )
    return {
        name: db[name].count_documents({"synthetic": True, "datasetId": dataset})
        for name in pending
    }


def cleanup(db, dataset):
    guard(db.name)
    ident(dataset)
    result = {}
    for name in ("reviews", "demo_purchases", "demo_profiles", "demo_datasets"):
        result[name] = (
            db[name]
            .delete_many({"synthetic": True, "datasetId": dataset})
            .deleted_count
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["seed", "cleanup"])
    parser.add_argument("--database", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--customers", type=int, choices=[1000, 10000], default=1000)
    parser.add_argument("--reviews", type=int, default=3000)
    parser.add_argument("--purchase-fraction", type=float, default=0.6)
    parser.add_argument("--random-seed", type=int, default=42)
    args = parser.parse_args()
    guard(args.database)
    uri = os.getenv("DEMO_MONGODB_URL")
    if not uri:
        raise ValueError(
            "Set DEMO_MONGODB_URL to isolated demo MongoDB credentials. No application URI fallback is allowed."
        )
    started = time.monotonic()
    with MongoClient(
        uri, serverSelectionTimeoutMS=5000, socketTimeoutMS=15000, tz_aware=True
    ) as client:
        db = client[args.database]
        products = json.loads(
            (ROOT / "products.json").read_text()
        )
        counts = (
            cleanup(db, args.dataset)
            if args.action == "cleanup"
            else seed(
                db,
                args.dataset,
                products,
                customers=args.customers,
                reviews=args.reviews,
                buyers=args.purchase_fraction,
                random_seed=args.random_seed,
            )
        )
    print(
        json.dumps(
            {"counts": counts, "elapsedSeconds": round(time.monotonic() - started, 2)}
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not print MongoDB URI or driver errors that could contain credentials.
        print(
            (
                str(exc)
                if isinstance(exc, ValueError)
                else "Demo operation failed; check database connectivity, permissions and dataset uniqueness. Re-run identical command to resume."
            ),
            file=sys.stderr,
        )
        sys.exit(1)
