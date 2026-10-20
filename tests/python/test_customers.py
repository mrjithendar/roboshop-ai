import copy
import os
import sys
import tempfile
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "services/user-service"))
sys.path[:0] = [str(ROOT / "services/ai-gateway/lib"), str(ROOT / "services/ai-gateway")]
from pymongo import MongoClient
from customers import Customers
from purchase_sync import PurchaseSync
from store import Store
from runtime import now, iso, HttpError


@unittest.skipUnless(
    os.getenv("MONGODB_URL"), "Needs an isolated MongoDB test connection"
)
class CustomerTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["MONGODB_URL"], tz_aware=True)
        self.db = self.client["customers_test_" + uuid.uuid4().hex]
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(self.directory.name)
        self.customers = Customers(self.db)
        self.sync = PurchaseSync(self.customers, self.store)

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()
        self.directory.cleanup()

    def test_login_metadata_retention_and_ip_validation(self):
        self.customers.record_login(
            "alice", "192.0.2.10", "Browser\nInjected", registration=True
        )
        self.customers.record_login("alice", "not-an-ip", "Second browser")
        profile = self.customers.profile("alice")["activity"]
        self.assertEqual(profile["loginCount"], 2)
        self.assertEqual(profile["registrationIp"], "192.0.2.10")
        self.assertIsNone(profile["lastLoginIp"])
        self.assertIsInstance(profile["lastLoginAt"], type(now()))
        self.db.login_activity.update_many(
            {"userId": "alice"}, {"$set": {"expiresAt": now() - timedelta(seconds=1)}}
        )
        self.assertEqual(self.customers.activity("alice")["events"], [])
        self.assertEqual(self.customers.profile("bob")["activity"], {})
        indexes = self.db.login_activity.index_information()
        self.assertEqual(indexes["expiresAt_1"]["expireAfterSeconds"], 0)

    def shipping(self, n=1):
        return {
            "address": {
                "recipient": "Private Customer",
                "line1": f"{n} Private Street",
                "postalCode": "500001",
            },
            "city": {"id": 1, "name": "Hyderabad", "country": "India"},
            "cost": 5,
            "quotedAt": iso(),
        }

    def test_addresses_are_deduplicated_bounded_and_separate(self):
        for i in range(12):
            self.customers.save_address("alice", self.shipping(i))
        self.customers.save_address("alice", self.shipping(11))
        self.assertEqual(
            self.db.customer_addresses.count_documents({"userId": "alice"}), 10
        )
        self.assertEqual(self.customers.profile("bob")["addresses"], [])

    def test_purchase_retry_snapshot_and_legacy_owner_backfill(self):
        owner = self.store.session(None, "alice")
        order = {
            "id": str(uuid.uuid4()),
            "session": owner,
            "status": "paid",
            "paidAt": iso(),
            "createdAt": iso(),
            "currency": "EUR",
            "subtotal": 20,
            "total": 25,
            "shipping": self.shipping(),
            "items": [
                {
                    "sku": "R",
                    "name": "Robot",
                    "price": 20,
                    "quantity": 1,
                    "lineTotal": 20,
                }
            ],
        }
        self.store.state["orders"].append(copy.deepcopy(order))
        self.store.save(self.store.state)
        original = self.customers.save_address
        with patch.object(
            self.customers,
            "save_address",
            side_effect=RuntimeError("temporary failure"),
        ):
            with self.assertRaises(RuntimeError):
                self.sync.sync()
        self.assertNotIn("customerSyncedAt", self.store.state["orders"][0])
        self.sync.sync()
        self.sync.sync()
        self.assertEqual(self.db.purchase_history.count_documents({}), 1)
        self.assertEqual(self.store.state["orders"][0]["userId"], "alice")
        self.assertIn("customerSyncedAt", self.store.state["orders"][0])
        self.assertEqual(self.customers.purchases("bob")["purchases"], [])
        result = self.customers.purchases("alice")["purchases"][0]
        self.assertEqual(result["shipping"]["address"]["line1"], "1 Private Street")
        self.assertNotIn("userId", result)
        self.assertEqual(
            self.customers.profile("alice")["purchaseSummary"][0]["orders"], 1
        )
        self.customers.project(order | {"userId": "alice", "total": 0})
        self.assertEqual(self.customers.purchases("alice")["purchases"][0]["total"], 25)

    def test_pagination_and_unknown_legacy_guest_ownership(self):
        for _ in range(23):
            self.db.purchase_history.insert_one(
                {
                    "_id": str(uuid.uuid4()),
                    "userId": "alice",
                    "paidAt": now(),
                    "total": 1,
                    "currency": "EUR",
                }
            )
        first = self.customers.purchases("alice")
        second = self.customers.purchases("alice", first["next"])
        self.assertEqual(len(first["purchases"]), 20)
        self.assertEqual(len(second["purchases"]), 3)
        self.assertFalse(
            set(p["id"] for p in first["purchases"])
            & set(p["id"] for p in second["purchases"])
        )
        with self.assertRaises(HttpError):
            self.customers.purchases("alice", "bad-cursor")
        self.store.state["orders"] = [
            {"id": str(uuid.uuid4()), "session": "unknown", "status": "paid"}
            for _ in range(101)
        ]
        self.sync.sync()
        self.assertTrue(
            all(not o.get("customerSyncedAt") for o in self.store.state["orders"])
        )
