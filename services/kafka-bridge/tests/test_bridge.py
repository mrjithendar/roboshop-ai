import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from bridge import deliver, handle, project, topology, TOPICS


def event(**overrides):
    return json.dumps(dict(eventId='evt-1', orderId='order-1', type='order.paid',
        paymentMode='live', demo=False, synthetic=False, inventoryProvenance='merchant',
        amount=999, currency='INR', shipping={'address': 'private'}, email='private', **overrides)).encode()


class BridgeTests(unittest.TestCase):
    def producer(self, error=None, remaining=0):
        producer = Mock()
        def flush(timeout):
            producer.produce.call_args.kwargs['on_delivery'](error, None)
            return remaining
        producer.flush.side_effect = flush
        return producer

    def test_live_projection_excludes_private_fields_preserves_amount(self):
        topic, key, body, _ = project(event())
        self.assertEqual(topic, TOPICS[0])
        self.assertEqual(key, 'order-1')
        self.assertEqual(json.loads(body)['amount'], 999)
        self.assertNotIn(b'private', body)
        self.assertNotIn('shipping', json.loads(body))

    def test_test_and_unknown_provenance_never_live(self):
        for patch in ({'paymentMode': 'test'}, {'demo': True}, {'synthetic': True},
                      {'inventoryProvenance': 'unknown'}, {'type': 'order.test-paid'}):
            data = json.loads(event()); data.update(patch)
            self.assertEqual(project(json.dumps(data))[0], TOPICS[1])

    def test_ack_only_after_delivery_confirmation(self):
        channel = Mock(); producer = self.producer()
        handle(channel, producer, SimpleNamespace(delivery_tag=3), event())
        channel.basic_ack.assert_called_once_with(delivery_tag=3)
        channel.basic_nack.assert_not_called()

    def test_failure_and_ambiguous_timeout_remain_unacknowledged(self):
        for producer in (self.producer(error='offline'), self.producer(remaining=1)):
            channel = Mock()
            with self.assertRaises(RuntimeError):
                handle(channel, producer, SimpleNamespace(delivery_tag=3), event())
            channel.basic_ack.assert_not_called()
            channel.basic_nack.assert_not_called()

    def test_malformed_event_quarantined(self):
        channel = Mock(); producer = Mock()
        handle(channel, producer, SimpleNamespace(delivery_tag=4), b'{invalid')
        channel.basic_nack.assert_called_once_with(delivery_tag=4, requeue=False)
        producer.produce.assert_not_called()

    def test_redelivery_keeps_same_deduplication_identity(self):
        producer = self.producer()
        deliver(producer, event()); deliver(producer, event())
        calls = producer.produce.call_args_list
        self.assertEqual(calls[0].kwargs['value'], calls[1].kwargs['value'])
        self.assertEqual(calls[0].kwargs['key'], calls[1].kwargs['key'])

    def test_topology_has_independent_queue_and_both_bindings(self):
        channel = Mock(); topology(channel)
        bindings = channel.queue_bind.call_args_list
        self.assertEqual({c.kwargs['routing_key'] for c in bindings}, {'order.paid', 'order.test-paid'})
        self.assertTrue(all(c.kwargs['queue'] == 'roboshop.kafka.orders' for c in bindings))

    def test_consumer_and_producer_preserve_context_without_payload(self):
        parent='00-'+'a'*32+'-'+'b'*16+'-01'
        spans=[];producer=self.producer();channel=Mock()
        with patch('runtime.telemetry',side_effect=lambda *args:spans.append(args)):
            handle(channel,producer,SimpleNamespace(delivery_tag=1),event(),SimpleNamespace(headers={'traceparent':parent,'tracestate':'vendor=value'}))
        self.assertEqual(len(spans),2)
        produced,consumed=spans
        self.assertEqual(produced[1]['parentSpanId'],consumed[1]['spanId'])
        self.assertEqual(consumed[1]['traceId'],'a'*32)
        headers=dict(producer.produce.call_args.kwargs['headers'])
        self.assertEqual(headers['traceparent'],'00-'+'a'*32+'-'+produced[1]['spanId']+'-01')
        self.assertEqual(headers['tracestate'],'vendor=value')
        self.assertNotIn('private',str(spans))


if __name__ == '__main__':
    unittest.main()
