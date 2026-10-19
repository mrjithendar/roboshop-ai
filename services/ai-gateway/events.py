import json
import threading
import pika
from runtime import trace_span, trace_header


class OrderPublisher:
    def __init__(self, store, url):
        self.store = store
        self.url = url
        self.stopped = threading.Event()

    def start(self):
        if self.url:
            threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while not self.stopped.is_set():
            connection = None
            try:
                with self.store.lock:
                    events = self.store.pending_events()[:50]
                if events:
                    params = pika.URLParameters(self.url)
                    params.socket_timeout = 5
                    params.stack_timeout = 10
                    params.blocked_connection_timeout = 5
                    params.heartbeat = 10
                    connection = pika.BlockingConnection(params)
                    channel = connection.channel()
                    for exchange in ("robotshop.orders", "robotshop.orders.dlx"):
                        channel.exchange_declare(
                            exchange=exchange, exchange_type="direct", durable=True
                        )
                    channel.queue_declare(
                        queue="robotshop.shipping.orders",
                        durable=True,
                        arguments={
                            "x-queue-type": "quorum",
                            "x-dead-letter-exchange": "robotshop.orders.dlx",
                            "x-dead-letter-routing-key": "shipping.failed",
                        },
                    )
                    channel.queue_declare(
                        queue="robotshop.shipping.failed",
                        durable=True,
                        arguments={"x-queue-type": "quorum"},
                    )
                    channel.queue_bind(
                        queue="robotshop.shipping.orders",
                        exchange="robotshop.orders",
                        routing_key="order.paid",
                    )
                    channel.queue_bind(
                        queue="robotshop.shipping.failed",
                        exchange="robotshop.orders.dlx",
                        routing_key="shipping.failed",
                    )
                    channel.confirm_delivery()
                    for event in events:
                        if self.stopped.is_set():
                            break
                        # Close a hung connection rather than leaving publisher confirms pending forever.
                        timer = threading.Timer(
                            5,
                            lambda: connection.add_callback_threadsafe(
                                connection.close
                            ),
                        )
                        timer.start()
                        try:
                            with trace_span(
                                "robotshop.orders publish",
                                kind=4,
                                parent=event.get("traceparent"),
                                service="ai-gateway",
                                attributes={
                                    "messaging.system": "rabbitmq",
                                    "messaging.destination.name": "robotshop.orders",
                                    "messaging.operation.type": "send",
                                },
                            ):
                                channel.basic_publish(
                                    exchange="robotshop.orders",
                                    routing_key="order.paid",
                                    body=json.dumps(event).encode(),
                                    mandatory=True,
                                    properties=pika.BasicProperties(
                                        delivery_mode=2,
                                        message_id=event["eventId"],
                                        type=event["type"],
                                        content_type="application/json",
                                        headers={"traceparent": trace_header()},
                                    ),
                                )
                        finally:
                            timer.cancel()
                        with self.store.lock:
                            self.store.event_published(event["eventId"])
            except Exception:
                print(
                    json.dumps(
                        {
                            "service": "ai-gateway",
                            "event": "order_event_delivery_pending",
                        }
                    ),
                    flush=True,
                )
            finally:
                if connection and connection.is_open:
                    try:
                        connection.close()
                    except Exception:
                        pass
            self.stopped.wait(2)

    def stop(self):
        self.stopped.set()
