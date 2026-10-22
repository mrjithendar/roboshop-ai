"""At-least-once order analytics stream. RabbitMQ remains the shipping transport."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'lib'))
from runtime import trace_span, propagation_headers, ctx, trace_context, telemetry
from datetime import datetime, timezone
from log_format import format_log
import json
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

QUEUE = 'roboshop.kafka.orders'
TOPICS = ('roboshop.orders.live.v1', 'roboshop.orders.test.v1')
STOP = threading.Event()
health = {'tick': time.monotonic(), 'ready': False}


def log(event, **fields):
    try:
        print(format_log({'timestamp':datetime.now(timezone.utc).isoformat(), 'level':'WARN' if event in ('delivery_retry','invalid_event_quarantined') else 'INFO', 'service':'kafka-bridge', 'event':event, 'trace_id':(ctx.get() or {}).get('traceId'), 'span_id':(ctx.get() or {}).get('spanId'), **fields}), flush=True)
    except (OSError, ValueError, TypeError):
        pass


def project(body):
    """Whitelist analytics fields; never copy addresses, user data or credentials."""
    event = json.loads(body)
    if not isinstance(event, dict) or event.get('type') not in ('order.paid', 'order.test-paid'):
        raise ValueError('Unsupported event')
    for key in ('eventId', 'orderId', 'currency'):
        if not isinstance(event.get(key), str) or not event[key] or len(event[key]) > 200:
            raise ValueError('Missing event identity/currency')
    if type(event.get('amount')) is not int or event['amount'] < 0:
        raise ValueError('Invalid minor-unit amount')
    live = (event['type'] == 'order.paid' and event.get('paymentMode') == 'live'
            and event.get('demo') is False and event.get('synthetic') is False
            and event.get('inventoryProvenance') == 'merchant')
    # Inconsistent provenance must never enter the live analytics topic.
    topic = TOPICS[0 if live else 1]
    payload = {key: event[key] for key in ('eventId', 'orderId', 'currency', 'amount', 'type')}
    payload.update(version=1, paymentMode=event.get('paymentMode', 'unknown'),
                   demo=event.get('demo', True), synthetic=event.get('synthetic', True),
                   inventoryProvenance=event.get('inventoryProvenance', 'unknown'))
    headers = [('eventId', event['eventId'])]
    trace = event.get('traceparent')
    if isinstance(trace, str) and len(trace) == 55:
        headers.append(('traceparent', trace))
    return topic, event['orderId'], json.dumps(payload).encode(), headers


def deliver(producer, body):
    topic, _, _, _ = project(body)
    with trace_span("publish " + topic, kind=4, service="kafka-bridge", attributes={"messaging.system":"kafka", "messaging.destination.name":topic, "messaging.operation.type":"send"}):
        return _deliver(producer, body)

def _deliver(producer, body):
    topic, key, payload, headers = project(body)
    headers = [(k,v) for k,v in headers if k not in ('traceparent','tracestate')] + list(propagation_headers().items())
    result = []
    producer.produce(topic, key=key, value=payload, headers=headers,
                     on_delivery=lambda error, message: result.append(error))
    # A timeout is ambiguous. Do not acknowledge RabbitMQ; redelivery may duplicate
    # a Kafka record. Downstream consumers must deduplicate by eventId.
    remaining = producer.flush(12)
    if remaining or not result or result[0] is not None:
        raise RuntimeError('Kafka delivery not confirmed')
    return topic


def handle(channel, producer, method, body, properties=None):
    headers = getattr(properties, 'headers', None) or {}
    with trace_span('process roboshop.kafka.orders', kind=5, parent=headers.get('traceparent'),
                    tracestate=headers.get('tracestate'), service='kafka-bridge',
                    attributes={'messaging.system':'rabbitmq','messaging.destination.name':QUEUE,'messaging.operation.type':'process'}):
        return _handle(channel, producer, method, body)

def _handle(channel, producer, method, body):
    try:
        topic = deliver(producer, body)
    except (ValueError, TypeError, KeyError):
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        log('invalid_event_quarantined')
        return
    channel.basic_ack(delivery_tag=method.delivery_tag)
    log('event_delivered', topic=topic)


def topology(channel):
    channel.exchange_declare(exchange='roboshop.orders', exchange_type='direct', durable=True)
    channel.queue_declare(queue='roboshop.kafka.failed', durable=True,
                          arguments={'x-queue-type': 'quorum'})
    channel.queue_declare(queue=QUEUE, durable=True, arguments={
        'x-queue-type': 'quorum', 'x-delivery-limit': -1,
        'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'roboshop.kafka.failed'})
    for key in ('order.paid', 'order.test-paid'):
        channel.queue_bind(queue=QUEUE, exchange='roboshop.orders', routing_key=key)


def run():
    import pika
    from confluent_kafka import Producer
    from confluent_kafka.admin import AdminClient, NewTopic
    from confluent_kafka import KafkaException, KafkaError
    bootstrap = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
    while not STOP.is_set():
        connection = None
        health.update(tick=time.monotonic(), ready=False)
        try:
            params = pika.URLParameters(os.environ['RABBITMQ_URL'])
            params.socket_timeout = 5
            params.stack_timeout = 10
            params.blocked_connection_timeout = 5
            params.heartbeat = 60
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            topology(channel)
            channel.basic_qos(prefetch_count=1)
            admin = AdminClient({'bootstrap.servers': bootstrap, 'socket.timeout.ms': 5000})
            for future in admin.create_topics([NewTopic(t, num_partitions=3, replication_factor=1,
                    config={'retention.ms': '604800000', 'retention.bytes': '268435456'}) for t in TOPICS], request_timeout=10).values():
                try:
                    future.result(timeout=12)
                except KafkaException as error:
                    if error.args[0].code() != KafkaError.TOPIC_ALREADY_EXISTS:
                        raise
            producer = Producer({'bootstrap.servers': bootstrap, 'enable.idempotence': True,
                                 'acks': 'all', 'delivery.timeout.ms': 10000,
                                 'request.timeout.ms': 5000, 'max.in.flight.requests.per.connection': 1})
            checked = 0
            for method, properties, body in channel.consume(QUEUE, inactivity_timeout=1):
                health['tick'] = time.monotonic()
                if STOP.is_set():
                    break
                if time.monotonic() - checked > 15:
                    producer.list_topics(timeout=5)
                    checked = time.monotonic()
                health['ready'] = True
                if method:
                    handle(channel, producer, method, body, properties)
        except Exception as error:
            health['ready'] = False
            log('delivery_retry', errorType=type(error).__name__, errorCode='KAFKA_DELIVERY_UNCONFIRMED', reason='Broker delivery not confirmed; RabbitMQ message remains unacknowledged', retryDelaySeconds=5)
        finally:
            if connection and connection.is_open:
                try:
                    connection.close()  # Unacknowledged messages return to the queue.
                except Exception:
                    pass
        STOP.wait(5)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        started=time.time_ns()
        context=trace_context(self.headers.get('traceparent'),self.headers.get('tracestate'))
        route=self.path if self.path in ('/health','/ready') else ''
        context['attributes']={'http.route':route,'http.request.method':'GET'}
        alive = time.monotonic() - health['tick'] < 90
        ok = alive and (self.path == '/health' or self.path == '/ready' and health['ready'])
        self.send_response(200 if ok else 503)
        self.end_headers()
        try: self.wfile.write(b'ok' if ok else b'unavailable')
        finally: telemetry('kafka-bridge',context,started,('GET '+route).rstrip(),200 if ok else 503)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    server = ThreadingHTTPServer(('0.0.0.0', 4113), HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    run()
    server.shutdown()
