"""Retry paid-order projection through the user service; orders remain gateway-owned."""
import copy
import json
import threading
from runtime import now

class PurchaseSync:
    def __init__(self, client, store):
        self.client, self.store = client, store
        self.stopped = threading.Event()

    def project(self, order):
        return self.client.project(order)

    def save_address(self, user_id, shipping):
        return self.client.save_address(user_id, shipping)

    def sync(self):
        with self.store.lock:
            orders = copy.deepcopy(
                [
                    o
                    for o in self.store.state["orders"]
                    if o["status"] == "paid" and not o.get("customerSyncedAt")
                ]
            )
            # Backfill old account orders only when a recorded account/cart relationship exists.
            for order in orders:
                if not order.get("userId"):
                    order["userId"] = (
                        self.store.state["sessions"]
                        .get(order["session"], {})
                        .get("userId")
                    )
        for order in [o for o in orders if o.get("userId")][:100]:
            if self.project(order):
                with self.store.lock:
                    state = copy.deepcopy(self.store.state)
                    stored = next(o for o in state["orders"] if o["id"] == order["id"])
                    stored["userId"] = order["userId"]
                    stored["customerSyncedAt"] = now().isoformat()
                    self.store.save(state)

    def run(self):
        while not self.stopped.is_set():
            try:
                self.sync()
            except Exception:
                print(
                    json.dumps(
                        {
                            "service": "ai-gateway",
                            "event": "customer_history_sync_pending",
                        }
                    ),
                    flush=True,
                )
            self.stopped.wait(2)

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stopped.set()
        if hasattr(self, "thread"):
            self.thread.join(timeout=3)

