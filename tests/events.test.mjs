import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OrderPublisher } from '../services/ai-gateway/events.mjs';

test('outbox retains unconfirmed events, retries and records confirmation only after broker ack', async () => {
  let confirmed = false, fail = true, attempts = 0;
  const event = { eventId: 'event-id', type: 'order.paid' };
  const store = { pendingEvents: () => confirmed ? [] : [event], eventPublished: id => { assert.equal(id, event.eventId); confirmed = true; } };
  const connect = async () => {
    const channel = new EventEmitter();
    for (const method of ['assertExchange','assertQueue','bindQueue']) channel[method] = async () => {};
    channel.publish = (exchange, route, bytes, options, callback) => {
      attempts++; assert.equal(route, 'order.paid'); assert.equal(options.persistent,true); assert.equal(options.mandatory,true);
      assert.equal(JSON.parse(bytes).eventId,event.eventId); callback(fail ? new Error('unconfirmed') : null);
    };
    const conn = new EventEmitter(); conn.createConfirmChannel = async () => channel; conn.close = async () => conn.emit('close'); return conn;
  };
  const publisher = new OrderPublisher(store, 'amqp://test', connect);
  await publisher.flush(); assert.equal(confirmed,false);
  fail = false; await publisher.flush(); assert.equal(confirmed,true);
  await publisher.flush(); assert.equal(attempts,2); await publisher.stop();
});
