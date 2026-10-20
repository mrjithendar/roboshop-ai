"""Private customer metadata and retryable MongoDB purchase-history projection."""

import base64
import copy
import hashlib
import ipaddress
import json
import os
import threading
from datetime import datetime, timedelta, timezone

from runtime import HttpError, now, trace_span
from decimal import Decimal, ROUND_HALF_UP

def cents(value):
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def address_from(shipping):
    if not shipping or not isinstance(shipping.get("address"), dict):
        return None
    # Store only validated shipping-service output, never arbitrary client metadata.
    return {
        "address": copy.deepcopy(shipping["address"]),
        "city": copy.deepcopy(shipping["city"]),
    }


class Customers:
    def __init__(self, db):
        self.db = db
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.retention = int(os.getenv("LOGIN_ACTIVITY_RETENTION_DAYS", "90"))
        if not 1 <= self.retention <= 3650:
            raise ValueError("LOGIN_ACTIVITY_RETENTION_DAYS must be 1–3650.")
        db.login_activity.create_index([("userId", 1), ("occurredAt", -1)])
        db.login_activity.create_index("expiresAt", expireAfterSeconds=0)
        db.customer_addresses.create_index([("userId", 1), ("updatedAt", -1)])
        db.purchase_history.create_index([("userId", 1), ("paidAt", -1), ("_id", -1)])
        db.purchase_history.create_index([("userId", 1), ("items.sku", 1), ("status", 1)])

    def record_login(self, user_id, address, agent, registration=False):
        try:
            address = str(ipaddress.ip_address(address))
        except ValueError:
            address = None
        agent = "".join(c for c in agent[:512] if c.isprintable())
        instant = now()
        with trace_span(
            "mongodb customer.login", kind=3, attributes={"db.system.name": "mongodb"}
        ):
            self.db.customer_profiles.update_one(
                {"_id": user_id},
                {
                    "$set": {
                        "lastLoginAt": instant,
                        "lastLoginIp": address,
                        "lastLoginUserAgent": agent,
                    },
                    "$inc": {"loginCount": 1},
                    "$setOnInsert": {"createdAt": instant},
                },
                upsert=True,
            )
            if registration:
                self.db.customer_profiles.update_one(
                    {"_id": user_id},
                    {"$set": {"registeredAt": instant, "registrationIp": address}},
                )
            self.db.login_activity.insert_one(
                {
                    "userId": user_id,
                    "event": "registration" if registration else "login",
                    "ipAddress": address,
                    "userAgent": agent,
                    "occurredAt": instant,
                    "expiresAt": instant + timedelta(days=self.retention),
                }
            )
            self.db.users.update_one(
                {"_id": user_id},
                {"$set": {"lastLoginAt": instant, "updatedAt": instant}},
            )

    def save_address(self, user_id, shipping):
        address = address_from(shipping)
        if not address:
            return
        key = hashlib.sha256(
            (user_id + json.dumps(address, sort_keys=True, ensure_ascii=False)).encode()
        ).hexdigest()
        with self.lock, trace_span(
            "mongodb customer.address", kind=3, attributes={"db.system.name": "mongodb"}
        ):
            self.db.customer_addresses.update_one(
                {"_id": key},
                {
                    "$set": {"userId": user_id, **address, "updatedAt": now()},
                    "$setOnInsert": {"createdAt": now()},
                },
                upsert=True,
            )
            # Keep the ten most recently used distinct addresses, independently of orders.
            stale = list(
                self.db.customer_addresses.find({"userId": user_id}, {"_id": 1})
                .sort([("updatedAt", -1), ("_id", -1)])
                .skip(10)
            )
            if stale:
                self.db.customer_addresses.delete_many(
                    {"userId": user_id, "_id": {"$in": [row["_id"] for row in stale]}}
                )

    def project(self, order):
        user_id = order.get("userId")
        if not user_id:
            return False
        purchase = {
            "_id": order["id"],
            "userId": user_id,
            "status": "paid",
            "synthetic": order.get("synthetic", False),
            "paymentCaptured": order.get("paymentCaptured", False),
            "paymentMode": order.get("paymentMode", "unknown"),
            "currency": order["currency"],
            "subtotal": order["subtotal"],
            "total": order["total"],
            "totalMinor": cents(order["total"]),
            "paidAt": timestamp(order["paidAt"]),
            "createdAt": timestamp(order["createdAt"]),
            "shipping": copy.deepcopy(order["shipping"]),
            "items": [
                {k: p[k] for k in ("sku", "name", "price", "quantity", "lineTotal")}
                for p in order["items"]
            ],
        }
        with trace_span(
            "mongodb customer.purchase",
            kind=3,
            attributes={"db.system.name": "mongodb"},
        ):
            # Immutable order snapshots and an order-ID key make replay safe.
            self.db.purchase_history.update_one(
                {"_id": order["id"]}, {"$setOnInsert": purchase}, upsert=True
            )
            self.save_address(user_id, order["shipping"])
        return True

    def profile(self, user_id):
        with trace_span(
            "mongodb customer.profile", kind=3, attributes={"db.system.name": "mongodb"}
        ):
            doc = self.db.customer_profiles.find_one({"_id": user_id}, {"_id": 0}) or {}
            addresses = [
                {
                    "id": row["_id"],
                    **{k: row[k] for k in ("address", "city", "updatedAt")},
                }
                for row in self.db.customer_addresses.find({"userId": user_id})
                .sort("updatedAt", -1)
                .limit(10)
            ]
            totals = list(
                self.db.purchase_history.aggregate(
                    [
                        {"$match": {"userId": user_id}},
                        {
                            "$group": {
                                "_id": "$currency",
                                "orders": {"$sum": 1},
                                "totalSpentMinor": {"$sum": "$totalMinor"},
                                "lastPurchaseAt": {"$max": "$paidAt"},
                            }
                        },
                    ]
                )
            )
            return {
                "activity": doc,
                "addresses": addresses,
                "purchaseSummary": [
                    {
                        "currency": row.pop("_id"),
                        "totalSpent": row["totalSpentMinor"] / 100,
                        **row,
                    }
                    for row in totals
                ],
            }

    def purchases(self, user_id, cursor=""):
        query = {"userId": user_id}
        if cursor:
            try:
                if len(cursor) > 512:
                    raise ValueError()
                paid_at, id = json.loads(base64.urlsafe_b64decode(cursor))
                if not isinstance(id, str) or len(id) != 36:
                    raise ValueError()
                paid_at = timestamp(paid_at)
                query["$or"] = [
                    {"paidAt": {"$lt": paid_at}},
                    {"paidAt": paid_at, "_id": {"$lt": id}},
                ]
            except Exception:
                raise HttpError(400, "Invalid purchase cursor.")
        rows = list(
            self.db.purchase_history.find(query)
            .sort([("paidAt", -1), ("_id", -1)])
            .limit(21)
        )
        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps([rows[19]["paidAt"].isoformat(), rows[19]["_id"]]).encode()
            ).decode()
            if len(rows) > 20
            else None
        )
        return {
            "purchases": [
                {
                    "id": row["_id"],
                    **{k: v for k, v in row.items() if k not in ("_id", "userId")},
                }
                for row in rows[:20]
            ],
            "next": next_cursor,
        }

    def activity(self, user_id):
        return {
            "events": list(
                self.db.login_activity.find(
                    {"userId": user_id, "expiresAt": {"$gt": now()}},
                    {"_id": 0, "userId": 0, "expiresAt": 0},
                )
                .sort("occurredAt", -1)
                .limit(20)
            ),
            "retentionDays": self.retention,
        }

    def verified(self, row):
        if row.get('synthetic'):
            return False
        created_at = row.get('createdAt')
        if isinstance(created_at, str):
            created_at = timestamp(created_at)
        if not isinstance(created_at, datetime) or any(not isinstance(row.get(k), str) for k in ('authorId', 'productId')):
            raise HttpError(400, 'Invalid purchase verification.')
        return bool(self.db.purchase_history.find_one({
            'userId': row['authorId'], 'items.sku': row['productId'], 'status': 'paid',
            'synthetic': {'$ne': True}, 'paymentCaptured': True, 'paymentMode': 'live',
            'paidAt': {'$lte': created_at},
        }, {'_id': 1}))
