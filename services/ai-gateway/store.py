from product_details import require_purchasable
"""Compatible single-writer JSON ledger; caller holds lock across transactions."""

import copy
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
    def __init__(self, directory):
        self.lock = threading.RLock()
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.file = Path(directory) / "store.json"
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

    def save(self, next_state):
        temp = str(self.file) + ".tmp"
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(next_state, out, allow_nan=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, self.file)
        self.state = next_state

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

    def pending(self, id):
        return next(
            (
                o
                for o in self.state["orders"]
                if o["session"] == id and o["status"] in PENDING
            ),
            None,
        )

    def reserved(self, sku):
        return sum(
            p["quantity"]
            for o in self.state["orders"]
            if o["status"] in PENDING
            for p in o["items"]
            if p["sku"] == sku
        )

    def available(self, p):
        return max(
            0,
            p["instock"]
            - self.state["sold"].get(p["sku"], 0)
            - self.reserved(p["sku"]),
        )

    def cart(self, id, products):
        items = []
        for sku, quantity in self.state["sessions"][id]["items"].items():
            p = next((p for p in products if p["sku"] == sku), None)
            if not p:
                raise HttpError(409, "A cart product is no longer available.")
            items.append(
                {
                    **p,
                    "instock": self.available(p),
                    "quantity": quantity,
                    "lineTotal": cents(p["price"]) * quantity / 100,
                }
            )
        subtotal = sum(cents(i["lineTotal"]) for i in items) / 100
        shipping = self.state["sessions"][id].get("shipping") if items else None
        return {
            "items": items,
            "subtotal": subtotal,
            "shipping": shipping,
            "total": (
                cents(subtotal) + cents(shipping.get("cost", 0) if shipping else 0)
            )
            / 100,
            "currency": "EUR",
        }

    def update(self, id, sku, quantity, products):
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
        p = next((p for p in products if p["sku"] == sku), None)
        if not p:
            raise HttpError(404, "Product not found.")
        if quantity > 0:
            require_purchasable(p)
        if quantity > self.available(p):
            raise HttpError(409, "Requested quantity exceeds available stock.")
        next_state = copy.deepcopy(self.state)
        if quantity == 0:
            next_state["sessions"][id]["items"].pop(sku, None)
        else:
            next_state["sessions"][id]["items"][sku] = quantity
        self.save(next_state)
        return self.cart(id, products)

    def set_shipping(self, id, shipping, products):
        if self.pending(id):
            raise HttpError(409, "A payment is pending. Shipping cannot be changed.")
        next_state = copy.deepcopy(self.state)
        next_state["sessions"][id]["shipping"] = shipping
        self.save(next_state)
        return self.cart(id, products)

    def begin_payment(self, id, key, products, payment_mode="unknown"):
        if not isinstance(key, str) or not re.fullmatch("[a-zA-Z0-9-]{16,80}", key):
            raise HttpError(400, "A valid idempotency key is required.")
        previous = next(
            (o for o in self.state["orders"] if o["session"] == id and o["key"] == key),
            None,
        )
        if previous or self.pending(id):
            return previous or self.pending(id)
        cart = self.cart(id, products)
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
            **cart,
            "createdAt": iso(),
            "status": "creating",
            "paymentCaptured": False,
            "paymentMode": payment_mode,
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

    def attach_payment(self, id, provider):
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        if order["status"] != "creating":
            raise HttpError(409, "Payment order state changed.")
        if (
            provider.get("amount") != cents(order["total"])
            or provider.get("currency") != order["currency"]
        ):
            raise HttpError(409, "Payment amount mismatch.")
        order.update(razorpayOrderId=provider["orderId"], status="payment_pending")
        self.save(state)
        return order

    def review_payment(self, id):
        state = copy.deepcopy(self.state)
        order = next(o for o in state["orders"] if o["id"] == id)
        if order["status"] == "creating":
            order["status"] = "payment_review"
            self.save(state)

    def pending_events(self):
        return [
            {
                **o["shipmentEvent"],
                "type": "order.paid",
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

    def mark_paid(self, id, payment):
        current = self.payment_order(id)
        if (
            payment.get("verified") is not True
            or payment.get("orderId") != current.get("razorpayOrderId")
            or payment.get("amount") != cents(current["total"])
            or payment.get("currency") != current["currency"]
            or not payment.get("paymentId")
        ):
            raise HttpError(409, "Payment confirmation mismatch.")
        if current["status"] == "paid":
            if current.get("paymentId") != payment["paymentId"]:
                raise HttpError(409, "Payment ID mismatch.")
            return current
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
            paymentCaptured=True,
            paymentId=payment["paymentId"],
            paidAt=iso(),
        )
        for p in order["items"]:
            state["sold"][p["sku"]] = state["sold"].get(p["sku"], 0) + p["quantity"]
        if order["session"] in state["sessions"]:
            state["sessions"][order["session"]]["items"] = {}
        self.save(state)
        return order
