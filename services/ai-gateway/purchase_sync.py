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
            orders = self.store.pending_purchases()
        for order in orders:
            # Lease metadata belongs to the ledger, not the public purchase record.
            payload = {k: v for k, v in order.items() if not k.startswith("_")}
            if self.project(payload):
                with self.store.lock:
                    self.store.purchase_projected(order)

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

