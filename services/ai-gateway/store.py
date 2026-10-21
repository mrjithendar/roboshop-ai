from product_details import purchasable, require_purchasable, checkout_provenance

"""One-process JSON ledger. Lock order: catalogue gate, cart gate, ledger lock.

Pure ledger transitions require the caller's ledger lock. Cart synchronization,
updates, shipping changes and reservation acquire their own locks; never wrap
those methods in the ledger lock, since Redis I/O must remain outside it.
"""

import copy
import fcntl
import weakref
import json
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from runtime import HttpError, iso, trace_header

PENDING = ("creating", "payment_pending", "payment_review")


def cents(value):
    return math.floor(value * 100 + 0.5)


class Store:
    def __init__(self, directory, cart_repository=None):
        self.cart_repository = cart_repository
        self.cart_revisions = {}
        self.lock = threading.RLock()
        self.catalogue_lock = threading.RLock()
        self._cart_locks = weakref.WeakValueDictionary()
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.file = Path(directory) / "store.json"
        writer = open(Path(directory) / "writer.lock", "a+")
        try:
            fcntl.flock(writer.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            writer.close()
            raise RuntimeError("Order ledger already has a writer. Run exactly one gateway process/replica.")
        self._release_writer = weakref.finalize(self, writer.close)
        self._writer_pid = os.getpid()
        try:
            self.state = (
                json.loads(self.file.read_text())
                if self.file.exists()
                else {"sessions": {}, "orders": [], "sold": {}}
            )
            if (
                not isinstance(self.state.get("sessions"), dict)
                or not isinstance(self.state.get("orders"), list)
                or not isinstance(self.state.get("sold"), dict)
            ):
                raise RuntimeError("Invalid store data; refusing to overwrite it.")

        except Exception:
            self.close()
            raise

        # A previous process may have reached the provider before it crashed.
        # Never replay create after restart, even if the crash preceded the call.
        recovered = copy.deepcopy(self.state)
        if "testSold" not in recovered:
            recovered["testSold"] = {}
            for order in recovered["orders"]:
                if order.get("paymentMode") == "test" and order["status"] == "paid":
                    for item in order["items"]:
                        sku, quantity = item["sku"], item["quantity"]
                        recovered["testSold"][sku] = recovered["testSold"].get(sku, 0) + quantity
                        recovered["sold"][sku] = max(0, recovered["sold"].get(sku, 0) - quantity)
        for order in recovered["orders"]:
            if order["status"] == "creating":
                order["status"] = "payment_review"
                order["revision"] = order.get("revision", 0) + 1
        if recovered != self.state:
            self.save(recovered)

    def close(self):
        self._release_writer()

    def cart_lock(self, id):
        with self.lock:
            return self._cart_locks.setdefault(id, threading.RLock())

    def cart_version(self, id):
        return self.state["sessions"][id].get("revision", 0)

    def check_writer(self):
        if not self._release_writer.alive or self._writer_pid != os.getpid():
            raise RuntimeError("Order ledger writer is closed or belongs to another process.")

    def save(self, next_state):
        self.check_writer()
        temp = str(self.file) + ".tmp"
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(next_state, out, allow_nan=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, self.file)
        self.state = next_state
        directory_fd = os.open(self.file.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def session(self, id, user_id=None):
        now = time.time() * 1000
        current = self.state["sessions"].get(id)
        if current and current["expires"] > now and current.get("userId") == user_id:
            return id
        if user_id:
            for key, value in self.state["sessions"].items():
                if value.get("userId") == user_id:
                    next_state = copy.deepcopy(self.state)
                    next_state["sessions"][key]["expires"] = now + 7 * 86400000
                    self.save(next_state)
                    return key
        next_state = copy.deepcopy(self.state)
        for key, value in list(next_state["sessions"].items()):
            if (
                value["expires"] <= now
                and not value.get("userId")
                and not self.pending(key)
            ):
                del next_state["sessions"][key]
        if len(next_state["sessions"]) >= 10000:
            raise HttpError(503, "Session capacity reached.")
        guest = (
            user_id
            and current
            and not current.get("userId")
            and current["expires"] > now
            and not self.pending(id)
        )
        if guest:
            del next_state["sessions"][id]
        id = str(uuid.uuid4())
        entry = {
            "items": current["items"] if guest else {},
            "userId": user_id,
            "expires": now + 7 * 86400000,
        }
        if guest and current.get("shipping"):
            entry["shipping"] = current["shipping"]
        next_state["sessions"][id] = entry
        self.save(next_state)
        return id

    def sync_cart(self, id):
        if not self.cart_repository:
            return
        # Only this customer's operations wait for Redis. No ledger lock over I/O.
        with self.cart_lock(id):
            with self.lock:
                if self.pending(id):
                    return  # The durable reservation is authoritative until settled.
                paid = [o["id"] for o in self.state["orders"] if o["session"] == id
                        and o["status"] == "paid" and not o.get("cartCleared")]
            for order_id in paid:
                self.cart_repository.clear_paid(id, order_id)
                with self.lock:
                    state = copy.deepcopy(self.state)
                    next(o for o in state["orders"] if o["id"] == order_id)["cartCleared"] = True
                    self.save(state)
            with self.lock:
                version = self.cart_version(id)
                items = copy.deepcopy(self.state["sessions"][id]["items"])
            result = self.cart_repository.initialize(id, items)
            with self.lock:
                if self.pending(id) or self.cart_version(id) != version:
                    raise HttpError(409, "Cart changed while synchronizing. Retry.")
                state = copy.deepcopy(self.state)
                entry = state["sessions"][id]
                if entry["items"] != result["items"]:
                    entry["revision"] = version + 1
                entry["items"] = result["items"]
                self.save(state)
                self.cart_revisions[id] = result["revision"]

    def pending(self, id):
        return next(
            (
                o
                for o in self.state["orders"]
                if o["session"] == id and o["status"] in PENDING
            ),
            None,
        )

    def reserved(self, sku, payment_mode=None):
        return sum(
            p["quantity"]
            for o in self.state["orders"]
            if o["status"] in PENDING and (payment_mode is None or o.get("paymentMode") == payment_mode or payment_mode == "live" and o.get("paymentMode") not in ("test", "live"))
            for p in o["items"]
            if p["sku"] == sku
        )

    def available(self, p, payment_mode=None):
        mode = payment_mode or os.getenv("PAYMENT_MODE", "test")
        sold = self.state.get("testSold", {}) if mode == "test" else self.state["sold"]
        return max(
            0,
            p["instock"]
            - sold.get(p["sku"], 0)
            - self.reserved(p["sku"], mode),
        )

    def cart(self, id, products, payment_mode=None):
        items = []
        for sku, quantity in self.state["sessions"][id]["items"].items():
            p = next((p for p in products if p["sku"] == sku), None)
            if not p or not purchasable(p):
                # Redis stores only SKU/quantity: do not fabricate product details or prices.
                items.append({"sku": sku, "quantity": quantity, "unavailable": True})
                continue
            items.append(
                {
                    **p,
                    "instock": self.available(p, payment_mode),
                    "quantity": quantity,
                    "lineTotal": cents(p["price"]) * quantity / 100,
                }
            )
        payable = [item for item in items if not item.get("unavailable")]
        currencies = {item.get("currency", "EUR") for item in payable}
        if len(currencies) > 1:
            raise HttpError(409, "Your cart contains mixed currencies. Remove items and retry.")
        currency = next(iter(currencies), "INR")
        subtotal = sum(cents(i["lineTotal"]) for i in payable) / 100
        shipping = self.state["sessions"][id].get("shipping") if payable else None
        if shipping and shipping.get("currency", "EUR") != currency:
            shipping = None
        return {
            "items": items,
            "subtotal": subtotal,
            "shipping": shipping,
            "total": (
                cents(subtotal) + cents(shipping.get("cost", 0) if shipping else 0)
            )
            / 100,
            "currency": currency,
        }

    def update(self, id, sku, quantity, products):
        with self.cart_lock(id):
            with self.lock:
                if self.pending(id):
                    raise HttpError(
                        409,
                        "A payment is pending. Complete or reconcile it before changing your bag.",
                    )
                if (
                    not isinstance(sku, str)
                    or not re.fullmatch("[A-Za-z0-9_-]{1,64}", sku)
                    or type(quantity) is not int
                    or not 0 <= quantity <= 20
                ):
                    raise HttpError(
                        400, "Use a valid SKU and an integer quantity from 0 to 20."
                    )
                if quantity > 0:
                    p = next((p for p in products if p["sku"] == sku), None)
                    if not p:
                        raise HttpError(404, "Product not found.")
                    require_purchasable(p)
                    existing = self.state["sessions"][id]["items"]
                    if any(purchasable(row) and row["sku"] in existing and row["sku"] != sku and row.get("currency", "EUR") != p.get("currency", "EUR") for row in products):
                        raise HttpError(409, "Please check out items in one currency at a time.")
                    if quantity > self.available(p):
                        raise HttpError(409, "Requested quantity exceeds available stock.")
                version = self.cart_version(id)
                items = copy.deepcopy(self.state["sessions"][id]["items"])
                if quantity == 0:
                    items.pop(sku, None)
                else:
                    items[sku] = quantity
                revision = self.cart_revisions.get(id)
            if self.cart_repository:
                result = self.cart_repository.replace(id, items, revision)
            with self.lock:
                if self.pending(id) or self.cart_version(id) != version:
                    raise HttpError(409, "Cart changed while updating. Retry.")
                state = copy.deepcopy(self.state)
                state["sessions"][id].update(items=items, revision=version + 1)
                if self.cart_repository:
                    self.cart_revisions[id] = result["revision"]
                self.save(state)
                return self.cart(id, products)

    def set_shipping(self, id, shipping, products):
        with self.cart_lock(id), self.lock:
            if self.pending(id):
                raise HttpError(409, "A payment is pending. Shipping cannot be changed.")
            if shipping.get("currency", "EUR") != self.cart(id, products)["currency"]:
                raise HttpError(409, "Shipping currency does not match your cart. Recalculate shipping.")
            next_state = copy.deepcopy(self.state)
            next_state["sessions"][id]["shipping"] = copy.deepcopy(shipping)
            next_state["sessions"][id]["revision"] = self.cart_version(id) + 1
            self.save(next_state)
            return self.cart(id, products)

    def begin_payment(self, id, key, products, payment_mode="test"):
        return self.reserve_payment(id, key, products, payment_mode)[0]

    def reserve_payment(self, id, key, products, payment_mode="test", key_id=None, expected_version=None):
        with self.cart_lock(id), self.lock:
            previous = self.existing_payment(id, key)
            if previous:
                return copy.deepcopy(previous), False
            if expected_version is not None and self.cart_version(id) != expected_version:
                raise HttpError(409, "Cart changed while preparing checkout. Refresh and retry.")
            return copy.deepcopy(self._begin_payment(id, key, products, payment_mode, key_id)), True

    def existing_payment(self, id, key):
        if not isinstance(key, str) or not re.fullmatch("[a-zA-Z0-9-]{16,80}", key):
            raise HttpError(400, "A valid idempotency key is required.")
        return next((o for o in self.state["orders"] if o["session"] == id and o["key"] == key), None) or self.pending(id)

    def _begin_payment(self, id, key, products, payment_mode="test", key_id=None):
        if not isinstance(key, str) or not re.fullmatch("[a-zA-Z0-9-]{16,80}", key):
            raise HttpError(400, "A valid idempotency key is required.")
        previous = next(
            (o for o in self.state["orders"] if o["session"] == id and o["key"] == key),
            None,
        )
        if previous or self.pending(id):
            return previous or self.pending(id)
        cart = self.cart(id, products, payment_mode)
        provenance = checkout_provenance(cart["items"], payment_mode)
        for item in cart["items"]:
            require_purchasable(item)
        if not cart["items"]:
            raise HttpError(400, "Your cart is empty.")
        if any(p["quantity"] > p["instock"] for p in cart["items"]):
            raise HttpError(409, "Stock changed. Update your cart before checking out.")
        if not cart["shipping"]:
            raise HttpError(
                400, "Add a delivery address and calculate shipping before payment."
            )
        try:
            expired = (
                time.time()
                - datetime.fromisoformat(
                    cart["shipping"]["quotedAt"].replace("Z", "+00:00")
                ).timestamp()
                > 86400
            )
        except (ValueError, KeyError):
            expired = True
        if expired:
            raise HttpError(
                409, "Your shipping quote expired. Calculate shipping again."
            )
        if len(self.state["orders"]) >= 10000:
            raise HttpError(503, "Order capacity reached.")
        order = {
            "id": str(uuid.uuid4()),
            "session": id,
            "userId": self.state["sessions"][id].get("userId"),
            "key": key,
            **copy.deepcopy(cart),
            "createdAt": iso(),
            "amount": cents(cart["total"]),
            "status": "creating",
            "paymentCaptured": False,
            "paymentMode": payment_mode,
            **provenance,
            "paymentKeyId": key_id,
            "revision": 0,
            "cartRevision": self.cart_version(id),
            "redisRevision": self.cart_revisions.get(id),
        }
        state = copy.deepcopy(self.state)
        state["orders"].append(order)
        self.save(state)
        return order

    def payment_order(self, id, session=None):
        order = next(
            (
                o
                for o in self.state["orders"]
                if o["id"] == id and (session is None or o["session"] == session)
            ),
            None,
        )
        if not order:
            raise HttpError(404, "Order not found.")
        return order

    def attach_payment(self, id, provider, expected_revision=None):
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        if (
            provider.get("amount") != order.get("amount", cents(order["total"]))
            or provider.get("currency") != order["currency"]
            or not provider.get("orderId")
            or provider.get("receipt", id) != id
            or (order.get("paymentKeyId") and provider.get("keyId") != order["paymentKeyId"])
            or (provider.get("mode") and provider["mode"] != order["paymentMode"])
        ):
            raise HttpError(409, "Payment amount mismatch.")
        if order["status"] in ("payment_pending", "paid") and order.get("razorpayOrderId") == provider["orderId"]:
            return copy.deepcopy(order)  # Matching late response/reconciliation is idempotent.
        if order["status"] not in ("creating", "payment_review") or (
            expected_revision is not None and order.get("revision", 0) != expected_revision
        ):
            raise HttpError(409, "Payment order state changed.")
        order.update(razorpayOrderId=provider["orderId"], status="payment_pending", revision=order.get("revision", 0) + 1)
        self.save(state)
        return order

    def review_payment(self, id, expected_revision=None):
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        if order["status"] == "creating" and (expected_revision is None or order.get("revision", 0) == expected_revision):
            order["status"] = "payment_review"
            order["revision"] = order.get("revision", 0) + 1
            self.save(state)

    def audit_reconciliation(self, id, actor, reason, outcome):
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        order.setdefault("reconciliationAudit", []).append({"actor": actor, "at": iso(),
            "reason": reason, "outcome": outcome, "orderRevision": order.get("revision", 0)})
        order["reconciliationAudit"] = order["reconciliationAudit"][-1000:]
        self.save(state)

    def pending_events(self):
        return [
            {
                **o["shipmentEvent"],
                "type": "order.paid" if o.get("paymentMode") == "live" and o.get("demo") is False and not o.get("synthetic") and o.get("inventoryProvenance") == "merchant" else "order.test-paid",
                "paymentMode": o.get("paymentMode", "unknown"),
                "demo": o.get("demo", True),
                "synthetic": o.get("synthetic", False),
                "inventoryProvenance": o.get("inventoryProvenance", "unknown"),
                "productProvenance": o.get("productProvenance", []),
                "version": 1,
                "orderId": o["id"],
                "shipping": o["shipping"],
                "items": [{k: p[k] for k in ("sku", "quantity")} for p in o["items"]],
            }
            for o in self.state["orders"]
            if o["status"] == "paid"
            and o.get("shipmentEvent")
            and not o["shipmentEvent"].get("publishedAt")
        ]

    def event_published(self, id):
        state = copy.deepcopy(self.state)
        for o in state["orders"]:
            if o.get("shipmentEvent", {}).get("eventId") == id and not o[
                "shipmentEvent"
            ].get("publishedAt"):
                o["shipmentEvent"]["publishedAt"] = iso()
                self.save(state)
                break

    def mark_paid(self, id, payment, expected_revision=None):
        current = self.payment_order(id)
        if (
            payment.get("verified") is not True
            or payment.get("orderId") != current.get("razorpayOrderId")
            or payment.get("amount") != current.get("amount", cents(current["total"]))
            or payment.get("currency") != current["currency"]
            or (payment.get("mode") is not None and payment["mode"] != current["paymentMode"])
            or (payment.get("keyId") is not None and payment["keyId"] != current.get("paymentKeyId"))
            or not payment.get("paymentId")
        ):
            raise HttpError(409, "Payment confirmation mismatch.")
        if current["status"] == "paid":
            if current.get("paymentId") != payment["paymentId"]:
                raise HttpError(409, "Payment ID mismatch.")
            return current
        if expected_revision is not None and current.get("revision", 0) != expected_revision:
            raise HttpError(409, "Payment order state changed.")
        if current["status"] != "payment_pending" or any(
            o.get("paymentId") == payment["paymentId"] for o in self.state["orders"]
        ):
            raise HttpError(409, "Payment already used or order state invalid.")
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        order.update(
            shipmentEvent={
                "eventId": str(uuid.uuid4()),
                "occurredAt": iso(),
                "traceparent": trace_header(),
            },
            status="paid",
            revision=current.get("revision", 0) + 1,
            paymentCaptured=True,
            paymentId=payment["paymentId"],
            paidAt=iso(),
        )
        bucket = "testSold" if order["paymentMode"] == "test" else "sold"
        for p in order["items"]:
            state.setdefault(bucket, {})[p["sku"]] = state[bucket].get(p["sku"], 0) + p["quantity"]
        if order["session"] in state["sessions"]:
            state["sessions"][order["session"]]["items"] = {}
        self.save(state)
        return order

    def session_entry(self, id):
        return self.state["sessions"].get(id)

    def orders(self, mode=None):
        return [o for o in self.state["orders"] if mode is None or o.get("paymentMode") == mode]

    def find_payment(self, provider_id, mode, key_id):
        return next((o for o in self.state["orders"] if o.get("razorpayOrderId") == provider_id and o.get("paymentMode") == mode and o.get("paymentKeyId") == key_id), None)

    def sold(self, sku, mode):
        return self.state.get("testSold" if mode == "test" else "sold", {}).get(sku, 0)

    def pending_purchases(self):
        orders = copy.deepcopy([o for o in self.state["orders"] if o["status"] == "paid" and not o.get("customerSyncedAt")])
        for order in orders:
            if not order.get("userId"):
                order["userId"] = self.state["sessions"].get(order["session"], {}).get("userId")
        return [o for o in orders if o.get("userId")][:100]

    def purchase_projected(self, order):
        state = copy.deepcopy(self.state)
        stored = next(o for o in state["orders"] if o["id"] == order["id"])
        stored["userId"] = order["userId"]
        stored["customerSyncedAt"] = iso()
        self.save(state)
