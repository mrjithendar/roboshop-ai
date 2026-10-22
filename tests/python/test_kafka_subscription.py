"""Gateway creates the analytics subscription before confirming its outbox event."""
import sys
from pathlib import Path
import threading
import unittest
from unittest.mock import Mock, patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/ai-gateway'))
sys.path.insert(0, str(ROOT / 'services/ai-gateway/lib'))
from events import OrderPublisher

class KafkaSubscriptionTests(unittest.TestCase):
    def test_durable_subscription_bound_before_publish(self):
        store = Mock(lock=threading.RLock())
        store.pending_events.return_value = [{'eventId': 'e1', 'orderId': 'o1', 'type': 'order.test-paid'}]
        publisher = OrderPublisher(store, 'amqp://guest:guest@localhost/')
        channel = Mock()
        def publish(**kwargs):
            queues = {call.kwargs['queue']: call.kwargs for call in channel.queue_declare.call_args_list}
            self.assertEqual(queues['roboshop.kafka.orders']['arguments']['x-delivery-limit'], -1)
            bindings = [c.kwargs['routing_key'] for c in channel.queue_bind.call_args_list if c.kwargs['queue'] == 'roboshop.kafka.orders']
            self.assertEqual(set(bindings), {'order.paid', 'order.test-paid'})
            publisher.stopped.set()
        channel.basic_publish.side_effect = publish
        connection = Mock(is_open=True)
        connection.channel.return_value = channel
        with patch('events.pika.BlockingConnection', return_value=connection):
            publisher.run()
        channel.basic_publish.assert_called_once()
        store.event_published.assert_called_once_with('e1')
