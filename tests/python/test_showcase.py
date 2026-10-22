import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
import mongomock
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "services/user-service"))
sys.path[:0] = [str(ROOT / "services/ai-gateway/lib"), str(ROOT / "services/ai-gateway")]
from runtime import HttpError, now, Request
from reviews import Reviews
from customers import Customers
from registration import Registration, TurnstileChallenge, client_address
from product_details import related, require_purchasable
from store import Store
from catalogue import retrieve
from server import Gateway

spec = importlib.util.spec_from_file_location(
    "seed_demo", ROOT / "services/catalogue-service/scripts/seed-demo.py"
)
seed_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_demo)
PRODUCTS = json.loads((ROOT / "services/catalogue-service/showcase-reference.json").read_text())
CUSTOMER = {"id": "alice", "role": "customer"}
ADMIN = {"id": "admin", "role": "admin"}
CONTENT = {
    "rating": 4,
    "title": "Useful learning material",
    "body": "A review written by a customer for moderation.",
}


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).db
        self.reviews = Reviews(self.db, verification=Customers(self.db).verified)

    def test_immediate_publication_ownership_and_admin_removal(self):
        r = self.reviews
        r.write("P", CUSTOMER, "POST", CONTENT)
        self.assertEqual(r.listing("P", {})["summary"]["count"], 1)
        with self.assertRaises(HttpError):
            r.write("P", CUSTOMER, "POST", CONTENT)
        with self.assertRaises(HttpError):
            r.write("P", {"id": "bob", "role": "customer"}, "PUT", CONTENT)
        row = self.db.reviews.find_one()
        with self.assertRaises(HttpError):
            r.moderate(row["_id"], CUSTOMER, {"status": "published"})
        r.moderate(row["_id"], ADMIN, {"status": "published"})
        self.assertEqual(r.listing("P", {})["summary"], {"count": 1, "average": 4})
        r.write("P", CUSTOMER, "PUT", {**CONTENT, "rating": 2})
        self.assertEqual(r.listing("P", {})["summary"]["count"], 1)
        r.moderate(row["_id"], ADMIN, {"status": "published"})
        self.assertEqual(r.listing("P", {})["summary"]["average"], 2)
        r.moderate(row["_id"], ADMIN, {"status": "hidden"})
        self.assertEqual(r.listing("P", {})["reviews"], [])
        r.write("P", {"id": "bob", "role": "customer"}, "DELETE")
        self.assertEqual(self.db.reviews.count_documents({}), 1)
        r.write("P", CUSTOMER, "DELETE")
        self.assertEqual(self.db.reviews.count_documents({}), 0)

    def test_validation_and_server_owned_fields(self):
        for value in [
            dict(CONTENT, rating=True),
            dict(CONTENT, rating=6),
            dict(CONTENT, title="<script>"),
            dict(CONTENT, body="tiny"),
            dict(CONTENT, authorId="other"),
            dict(CONTENT, status="published"),
            dict(CONTENT, verifiedPurchase=True),
            dict(CONTENT, synthetic=True),
        ]:
            with self.subTest(value=value), self.assertRaises(HttpError):
                self.reviews.write("P", CUSTOMER, "POST", value)

    def assert_public_ratings(self, expected):
        result = self.reviews.listing("P", {})
        self.assertEqual(sorted(row["rating"] for row in result["reviews"]), sorted(expected))
        self.assertEqual(result["summary"], {"count": len(expected), "average": sum(expected) / len(expected) if expected else None})
        self.assertEqual(result["distribution"], {str(i): expected.count(i) for i in range(1, 6)})

    def test_edits_preserve_each_moderation_status_and_metadata(self):
        self.reviews.write("P", {"id": "bob", "role": "customer"}, "POST", {**CONTENT, "rating": 3})
        self.reviews.write("P", CUSTOMER, "POST", CONTENT)
        row = self.db.reviews.find_one({"authorId": "alice"})
        for status in ("published", "hidden", "pending"):
            with self.subTest(status=status):
                self.reviews.moderate(row["_id"], ADMIN, {"status": status})
                before = self.db.reviews.find_one({"_id": row["_id"]})
                result = self.reviews.write("P", CUSTOMER, "PUT", {**CONTENT, "rating": 2, "title": "Updated review"})
                after = self.db.reviews.find_one({"_id": row["_id"]})
                self.assertEqual(after["rating"], 2)
                self.assertEqual(after["title"], "Updated review")
                for field in ("status", "moderatedBy", "moderatedAt", "createdAt", "authorId", "productId", "synthetic"):
                    self.assertEqual(after[field], before[field], field)
                self.assertIn(status, result["message"])
                self.assert_public_ratings([3, 2] if status == "published" else [3])
                filtered = self.reviews.listing("P", {"rating": "2"})
                self.assertEqual(filtered["summary"]["count"], 1 if status == "published" else 0)
                self.assertEqual(filtered["distribution"]["2"], 1 if status == "published" else 0)
                # An authorized moderator can restore the edited content.
                self.reviews.moderate(row["_id"], {"id": "super", "role": "superadmin"}, {"status": "published"})
                self.assertEqual(self.db.reviews.find_one({"_id": row["_id"]})["moderatedBy"], "super")
                self.assert_public_ratings([3, 2])

    def test_edits_reject_identity_status_and_moderation_field_changes(self):
        self.reviews.write("P", CUSTOMER, "POST", CONTENT)
        row = self.db.reviews.find_one()
        for field, value in {"authorId": "bob", "productId": "OTHER", "status": "published", "moderatedBy": "alice", "moderatedAt": now(), "synthetic": True}.items():
            with self.subTest(field=field), self.assertRaises(HttpError):
                self.reviews.write("P", CUSTOMER, "PUT", {**CONTENT, field: value})
        for user in (None, {"id": "bob", "role": "customer"}, ADMIN):
            with self.subTest(user=user), self.assertRaises(HttpError):
                self.reviews.write("P", user, "PUT", CONTENT)
        for status in ("hidden", "pending"):
            self.reviews.moderate(row["_id"], ADMIN, {"status": status})
            with self.assertRaises(HttpError):
                self.reviews.moderate(row["_id"], CUSTOMER, {"status": "published"})
            self.assertEqual(self.db.reviews.find_one()["status"], status)
        self.assertEqual(self.db.reviews.find_one()["authorId"], "alice")

    def test_concurrent_edit_and_moderation_preserve_both_updates(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        self.reviews.write("P", CUSTOMER, "POST", CONTENT)
        row = self.db.reviews.find_one()
        collection = self.db.reviews
        atomic_update = collection.find_one_and_update
        for status in ("hidden", "pending", "published"):
            for moderation_first in (True, False):
                with self.subTest(status=status, moderation_first=moderation_first):
                    reached, release = Event(), Event()
                    def paused_edit(key, update, **kwargs):
                        if "authorId" in key:
                            self.assertEqual(key, {"productId": "P", "authorId": "alice", "synthetic": False})
                            self.assertEqual(set(update["$set"]), {"rating", "title", "body", "updatedAt"})
                            if not moderation_first:
                                result = atomic_update(key, update, **kwargs)
                            reached.set()
                            if not release.wait(5):
                                raise AssertionError("Edit was not released")
                            return atomic_update(key, update, **kwargs) if moderation_first else result
                        return atomic_update(key, update, **kwargs)
                    with patch.object(collection, "find_one_and_update", side_effect=paused_edit), ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(self.reviews.write, "P", CUSTOMER, "PUT", {**CONTENT, "rating": 1})
                        try:
                            self.assertTrue(reached.wait(5), "Edit did not reach atomic update")
                            self.reviews.moderate(row["_id"], ADMIN, {"status": status})
                            decision = collection.find_one({"_id": row["_id"]})
                        finally:
                            release.set()
                        future.result(timeout=5)
                    final = collection.find_one({"_id": row["_id"]})
                    self.assertEqual(final["rating"], 1)
                    for field in ("status", "moderatedBy", "moderatedAt"):
                        self.assertEqual(final[field], decision[field])
                    self.assert_public_ratings([1] if status == "published" else [])

    def test_verified_purchase_needs_own_captured_live_order(self):
        self.reviews.write("P", CUSTOMER, "POST", CONTENT)
        row = self.db.reviews.find_one()
        order = {
            "userId": "alice",
            "items": [{"sku": "P"}],
            "status": "paid",
            "paidAt": now() - timedelta(days=1),
            "paymentCaptured": True,
            "paymentMode": "live", "demo": False, "inventoryProvenance": "merchant",
            "productProvenance": [{"sku":"P", "demo":False, "synthetic":False, "fulfilment":"merchant"}],
            "synthetic": False,
        }
        self.db.purchase_history.insert_one({**order, "userId": "bob"})
        self.assertFalse(self.reviews.verified(row))
        for update in [
            {"synthetic": True},
            {"paymentMode": "test"},
            {"paymentCaptured": False},
            {"paidAt": now() + timedelta(days=1)},
        ]:
            self.db.purchase_history.delete_many({})
            self.db.purchase_history.insert_one({**order, **update})
            self.assertFalse(self.reviews.verified(row))
        self.db.purchase_history.delete_many({})
        self.db.purchase_history.insert_one(order)
        self.assertTrue(self.reviews.verified(row))
        self.assertFalse(self.reviews.verified({**row, "synthetic": True}))

    def test_pagination_and_demo_separation(self):
        for i in range(25):
            self.db.reviews.insert_one(
                {
                    "_id": f"r{i:03}",
                    "productId": "P",
                    "authorId": str(i),
                    **CONTENT,
                    "createdAt": now(),
                    "updatedAt": now(),
                    "synthetic": i == 24,
                    "status": "published",
                }
            )
        first = self.reviews.listing("P", {})
        self.assertEqual(len(first["reviews"]), 20)
        second = self.reviews.listing("P", {"after": first["next"]})
        self.assertEqual(len(second["reviews"]), 4)
        self.assertEqual(first["summary"]["count"], 24)
        self.assertEqual(
            self.reviews.listing("P", {"kind": "demo"})["summary"]["count"], 1
        )
        with self.assertRaises(HttpError):
            self.reviews.listing("P", {"kind": "all"})


class ChallengeTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).db
        self.env = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "REGISTRATION_CHALLENGE_PROVIDER": "turnstile",
                "TURNSTILE_SITE_KEY": "public-site",
                "TURNSTILE_SECRET_KEY": "private-secret",
                "TURNSTILE_HOSTNAME": "shop.example",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.registration = Registration(self.db)

    def connection(self, **changes):
        conn = Mock()
        conn.getresponse.return_value.status = 200
        result = {
            "success": True,
            "hostname": "shop.example",
            "action": "register",
            "challenge_ts": now().isoformat(),
            **changes,
        }
        conn.getresponse.return_value.read.return_value = json.dumps(result).encode()
        return conn

    def test_success_replay_and_public_secret_boundary(self):
        with patch(
            "registration.http.client.HTTPSConnection", return_value=self.connection()
        ) as connection:
            self.registration.check(
                {"challengeToken": "fresh", "website": ""}, "192.0.2.1"
            )
            with self.assertRaises(HttpError):
                self.registration.check({"challengeToken": "fresh"}, "192.0.2.1")
            self.assertEqual(connection.call_count, 1)
        self.assertNotIn("private-secret", json.dumps(self.registration.public()))

    def test_login_requires_login_action_and_consumes_token(self):
        with patch('registration.http.client.HTTPSConnection', return_value=self.connection(action='login')):
            data = {'email':'user@example.com','password':'password','challengeToken':'login-token'}
            self.registration.check(data, '192.0.2.1', 'login')
            self.assertNotIn('challengeToken',data)
            with self.assertRaises(HttpError):
                self.registration.check({'challengeToken':'login-token'}, '192.0.2.1', 'login')
        with patch('registration.http.client.HTTPSConnection', return_value=self.connection(action='register')), self.assertRaises(HttpError):
            self.registration.check({'challengeToken':'wrong-action'}, '192.0.2.1', 'login')

    def test_invalid_secret_is_not_reported_as_timeout(self):
        conn = self.connection(success=False, **{'error-codes':['invalid-input-secret']})
        conn.getresponse.return_value.status = 400
        with patch('registration.http.client.HTTPSConnection', return_value=conn):
            with self.assertRaises(HttpError) as error:
                TurnstileChallenge().verify('token', '192.0.2.1', 'login')
            self.assertIn('misconfigured', str(error.exception))
            self.assertNotIn('timed out', str(error.exception))
        conn.close.assert_called_once()

    def test_failure_expiry_hostname_action_and_timeout(self):
        for changes in [
            {"success": False, "error-codes": ["timeout-or-duplicate"]},
            {"hostname": "evil.example"},
            {"action": "login"},
            {"challenge_ts": (now() - timedelta(minutes=6)).isoformat()},
        ]:
            with patch(
                "registration.http.client.HTTPSConnection",
                return_value=self.connection(**changes),
            ), self.assertRaises(HttpError):
                TurnstileChallenge().verify("token", "192.0.2.1")
        conn = self.connection()
        conn.request.side_effect = TimeoutError()
        with patch(
            "registration.http.client.HTTPSConnection", return_value=conn
        ), self.assertRaises(HttpError):
            TurnstileChallenge().verify("token", "192.0.2.1")
        conn.close.assert_called_once()

    def test_limits_shared_across_replicas_and_honeypot(self):
        with patch.dict(os.environ, {"REGISTRATION_CHALLENGE_PROVIDER": "disabled"}):
            other = Registration(self.db)
            for i in range(5):
                (other if i % 2 else self.registration).check({}, "one-ip")
            with self.assertRaises(HttpError) as err:
                other.check({}, "one-ip")
            self.assertEqual(err.exception.status, 429)
            with self.assertRaises(HttpError):
                other.check({"website": "bot"}, "other-ip")
            with patch.dict(os.environ, {"APP_ENV": "production"}), self.assertRaises(
                HttpError
            ):
                other.check({}, "new-ip")

    def test_proxy_peer_must_be_explicitly_trusted(self):
        req = SimpleNamespace(
            environ={"REMOTE_ADDR": "192.0.2.1"}, headers={"x-real-ip": "198.51.100.1"}
        )
        with patch.dict(
            os.environ, {"TRUST_PROXY": "true", "TRUSTED_PROXY_CIDRS": "127.0.0.1/32"}
        ):
            self.assertEqual(client_address(req), "192.0.2.1")
            req.environ["REMOTE_ADDR"] = "127.0.0.1"
            self.assertEqual(client_address(req), "198.51.100.1")
            req.headers["x-real-ip"] = "bad, forged"
            self.assertEqual(client_address(req), "127.0.0.1")


class ShowcaseTests(unittest.TestCase):
    def test_offline_global_dataset_has_200_countries_and_no_login_accounts(self):
        countries=set(); counts={'demo_profiles':0,'reviews':0,'demo_purchases':0}
        def write(name,row):
            counts[name]+=1
            self.assertTrue(row['synthetic'])
            if name=='demo_profiles':
                countries.add(row['country'])
                self.assertTrue(row['authenticationDisabled'])
                self.assertTrue(row['email'].endswith('@example.com'))
            if name=='reviews': self.assertIn('SYNTHETIC DEMO REVIEW',row['body'])
        with patch.dict(os.environ,{'APP_ENV':'demo','DEPLOYMENT_ENVIRONMENT':'test','NODE_ENV':'test','ENVIRONMENT':'test'}):
            result=seed_demo.seed(SimpleNamespace(name='roboshop_demo_global'),'global-test',PRODUCTS,writer=write)
        self.assertEqual(result['demo_profiles'],1000)
        self.assertEqual(result['reviews'],3000)
        self.assertEqual(len(countries),200)
        self.assertIn('US',countries)

    def test_sources_unique_slugs_and_types(self):
        self.assertEqual(len(PRODUCTS), 32)
        self.assertEqual(len({p["sku"] for p in PRODUCTS}), 32)
        self.assertEqual(len({p["slug"] for p in PRODUCTS}), 32)
        for p in PRODUCTS:
            self.assertTrue(p["sources"][0]["url"].startswith("https://"))
            self.assertTrue(p["specifications"])
            self.assertTrue(p["showcase"])
            self.assertEqual(p["fulfilment"], "simulated")
            with self.assertRaises(HttpError):
                require_purchasable(p)

    def test_currency_policy_and_related_exclusions(self):
        p = {
            "sku": "P",
            "name": "Robot",
            "description": "Robot",
            "categories": ["robots"],
            "price": 20,
            "instock": 3,
            "currency": "EUR",
            "priceType": "sale",
        }
        require_purchasable(p)
        require_purchasable({**p, "currency": "USD"})
        require_purchasable({**p, "currency": "INR"})
        for change in [
            {"currency": "XYZ"},
            {"priceType": "reference"},
            {"synthetic": True},
            {"showcase": True},
        ]:
            with self.assertRaises(HttpError):
                require_purchasable({**p, **change})
        nearby = {**p, "sku": "N", "price": 21}
        rows = [
            p,
            nearby,
            {**p, "sku": "A", "archived": True},
            {**p, "sku": "Z", "instock": 0},
            {**p, "sku": "USD", "currency": "USD"},
        ]
        self.assertEqual([r["sku"] for r in related(p, rows)], ["N", "USD"])
        self.assertEqual([r["sku"] for r in retrieve(rows, "under $25")], ["USD"])

    def test_cart_and_payment_are_blocked_even_with_injected_cart(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            session = store.session(None, "alice")
            product = PRODUCTS[0]
            with self.assertRaises(HttpError):
                store.update(session, product["sku"], 1, PRODUCTS)
            store.state["sessions"][session]["items"][product["sku"]] = 1
            with self.assertRaises(HttpError):
                store.begin_payment(session, "a" * 32, PRODUCTS)
            self.assertEqual(store.state["orders"], [])

    def test_detail_api_unknown_slug_and_direct_refresh(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        with patch.dict(os.environ, {"USER_SERVICE_TOKEN": "u" * 64}):
            gateway = Gateway(
                mongomock.MongoClient(tz_aware=True).db, Store(directory.name)
            )
        gateway.catalogue = lambda: PRODUCTS
        gateway.auth.current = lambda token: None
        slug = PRODUCTS[0]["slug"]
        request = lambda path: Request({"REQUEST_METHOD": "GET", "PATH_INFO": path})
        result = gateway.handle(request("/api/products/" + slug))
        self.assertEqual(result["product"]["sku"], PRODUCTS[0]["sku"])
        self.assertNotIn(PRODUCTS[0]["sku"], [p["sku"] for p in result["related"]])
        static = Path(directory.name) / "services/frontend/dist"
        static.mkdir(parents=True)
        (static / "product.html").write_bytes(
            (ROOT / "services/frontend/product.html").read_bytes()
        )
        with patch("server.STATIC_ROOT", static):
            for _ in range(2):
                body, status, _ = gateway.handle(request("/products/" + slug))
                self.assertEqual(status, 200)
                self.assertIn(b"product-main", body)
        with self.assertRaises(HttpError) as err:
            gateway.handle(request("/api/products/missing-slug"))
        self.assertEqual(err.exception.status, 404)
        self.assertIsNone(gateway.handle(request("/products/private.js")))
        self.assertIsNone(gateway.handle(request("/.env")))

    def test_gateway_blocks_provider_calls_and_challenge_before_hash(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        with patch.dict(os.environ, {"USER_SERVICE_TOKEN": "u" * 64}):
            gateway = Gateway(
                mongomock.MongoClient(tz_aware=True).db, Store(directory.name)
            )
        gateway.catalogue = lambda: PRODUCTS
        gateway.auth.current = lambda token: CUSTOMER

        def req(path, data):
            raw = json.dumps(data).encode()
            return Request(
                {
                    "REQUEST_METHOD": "POST",
                    "PATH_INFO": path,
                    "CONTENT_TYPE": "application/json",
                    "CONTENT_LENGTH": str(len(raw)),
                    "wsgi.input": io.BytesIO(raw),
                    "HTTP_ORIGIN": gateway.origin,
                    "REMOTE_ADDR": "192.0.2.1",
                }
            )

        id = gateway.store.session(None, "alice")
        gateway.session = lambda request: id
        gateway.store.state["sessions"][id]["items"][PRODUCTS[0]["sku"]] = 1
        gateway.payment = Mock(
            side_effect=AssertionError("Provider must not be called")
        )
        with self.assertRaises(HttpError):
            gateway.handle(req("/api/payments/orders", {}))
        gateway.payment.assert_not_called()
        gateway.auth.forward = Mock(
            side_effect=HttpError(400, "challenge failed")
        )
        with self.assertRaises(HttpError):
            gateway.handle(
                req(
                    "/api/auth/register",
                    {
                        "name": "Test",
                        "email": "test@example.com",
                        "password": "not-hashed",
                    },
                )
            )
        gateway.auth.forward.assert_called_once()


@unittest.skipUnless(
    os.getenv("MONGODB_URL"), "Needs isolated MongoDB for seed bulk-write/index tests"
)
class SeedTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["MONGODB_URL"], tz_aware=True)
        self.db = self.client["roboshop_demo_test_" + uuid.uuid4().hex[:16]]
        self.env = patch.dict(
            os.environ,
            {
                "APP_ENV": "demo",
                "MONGODB_DATABASE": "roboshop",
                "NODE_ENV": "test",
                "DEPLOYMENT_ENVIRONMENT": "test",
                "ENVIRONMENT": "test",
            },
        )
        self.env.start()

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()
        self.env.stop()

    def test_repeatable_idempotent_integrity_and_cleanup(self):
        args = dict(customers=12, reviews=36, buyers=1, small_test=True)
        first = seed_demo.seed(self.db, "small", PRODUCTS, **args)
        self.assertEqual(
            first, {"demo_profiles": 12, "demo_purchases": 36, "reviews": 36}
        )
        before = list(self.db.reviews.find().sort("_id", 1))
        self.assertEqual(seed_demo.seed(self.db, "small", PRODUCTS, **args), first)
        self.assertEqual(before, list(self.db.reviews.find().sort("_id", 1)))
        self.assertEqual(self.db.users.count_documents({}), 0)
        self.assertEqual(self.db.purchase_history.count_documents({}), 0)
        for row in self.db.demo_purchases.find():
            user = self.db.demo_profiles.find_one({"_id": row["userId"]})
            self.assertTrue(user["authenticationDisabled"])
            self.assertTrue(user["email"].endswith("@example.com"))
            self.assertGreater(row["createdAt"], user["createdAt"])
            self.assertEqual(
                row["totalMinor"],
                sum(i["unitPriceMinor"] * i["quantity"] for i in row["items"]),
            )
            for item in row["items"]:
                self.assertIsNotNone(self.db.products.find_one({"sku": item["sku"]}))
            self.assertNotIn("paymentId", row)
        for row in before:
            if row["demoPurchaseId"]:
                order = self.db.demo_purchases.find_one({"_id": row["demoPurchaseId"]})
                self.assertEqual(order["userId"], row["authorId"])
                self.assertGreater(row["createdAt"], order["createdAt"])
        # Resume after interrupted partial deletion and enforce one review per author/product in Mongo itself.
        self.db.reviews.delete_one({"_id": before[0]["_id"]})
        seed_demo.seed(self.db, "small", PRODUCTS, **args)
        self.assertEqual(before, list(self.db.reviews.find().sort("_id", 1)))
        from pymongo.errors import DuplicateKeyError

        with self.assertRaises(DuplicateKeyError):
            self.db.reviews.insert_one({**before[0], "_id": "duplicate"})
        seed_demo.seed(self.db, "other", PRODUCTS, **args)
        self.db.reviews.insert_one(
            {
                "_id": "genuine",
                "productId": "P",
                "authorId": "real",
                "synthetic": False,
                "datasetId": "small",
            }
        )
        seed_demo.cleanup(self.db, "small")
        self.assertIsNotNone(self.db.reviews.find_one({"_id": "genuine"}))
        self.assertEqual(
            self.db.demo_profiles.count_documents({"datasetId": "other"}), 12
        )
        self.assertEqual(
            self.db.demo_profiles.count_documents({"datasetId": "small"}), 0
        )

    def test_production_refusal_and_manifest_mismatch(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            with self.assertRaises(ValueError):
                seed_demo.seed(self.db, "small", PRODUCTS)
            with self.assertRaises(ValueError):
                seed_demo.cleanup(self.db, "small")
        with self.assertRaises(ValueError):
            seed_demo.guard("roboshop")
        with self.assertRaises(ValueError):
            seed_demo.seed(self.db, "small", PRODUCTS, customers=10)
        seed_demo.seed(
            self.db, "small", PRODUCTS, customers=2, reviews=2, small_test=True
        )
        with self.assertRaises(ValueError):
            seed_demo.seed(
                self.db, "small", PRODUCTS, customers=2, reviews=3, small_test=True
            )

class DemoReviewIsolationTests(unittest.TestCase):
    def test_demo_database_is_separate_and_rating_filter_is_validated(self):
        client=mongomock.MongoClient(tz_aware=True)
        db=client.real; demo=client.roboshop_demo_global
        row=dict(_id='demo:1',productId='P',authorId='demo:user',rating=5,title='Synthetic example',body='SYNTHETIC DEMO REVIEW',synthetic=True,status='published',createdAt=now(),updatedAt=now())
        demo.reviews.insert_one(row)
        reviews=Reviews(db,demo)
        self.assertEqual(reviews.listing('P',{})['summary']['count'],0)
        result=reviews.listing('P',{'kind':'demo','rating':'5'})
        self.assertEqual(result['summary']['count'],1)
        self.assertEqual(result['distribution']['5'],1)
        self.assertFalse(result['reviews'][0]['verifiedPurchase'])
        self.assertEqual(reviews.listing('P',{'kind':'demo','rating':'1'})['reviews'],[])
        with self.assertRaises(HttpError):reviews.listing('P',{'rating':'99'})
