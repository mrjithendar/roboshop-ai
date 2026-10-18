import amqp from 'amqplib';

export const queue = 'robotshop.shipping.orders';
export async function topology(channel) {
  await channel.assertExchange('robotshop.orders', 'direct', { durable: true });
  await channel.assertExchange('robotshop.orders.dlx', 'direct', { durable: true });
  await channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': 'robotshop.orders.dlx', 'x-dead-letter-routing-key': 'shipping.failed' } });
  await channel.assertQueue('robotshop.shipping.failed', { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await channel.bindQueue(queue, 'robotshop.orders', 'order.paid');
  await channel.bindQueue('robotshop.shipping.failed', 'robotshop.orders.dlx', 'shipping.failed');
}
export class OrderPublisher {
  constructor(store, url, connect = amqp.connect) { this.store = store; this.url = url; this.connect = connect; this.busy = false; this.stopped = false; }
  start() {
    if (!this.url) return;
    void this.flush(); this.timer = setInterval(() => void this.flush(), 2000); this.timer.unref();
  }
  async flush() {
    if (this.busy || this.stopped || !this.url) return;
    this.busy = true;
    try {
      if (!this.channel) {
        const connection = await this.connect(this.url, { timeout: 5000 });
        connection.on('error', () => {});
        connection.on('close', () => { if (this.connection === connection) this.channel = null; });
        this.connection = connection;
        if (this.stopped) { await connection.close(); return; }
        const channel = await connection.createConfirmChannel();
        channel.on('error', () => {});
        channel.on('close', () => { if (this.channel === channel) this.channel = null; });
        await topology(channel); this.channel = channel;
      }
      for (const event of this.store.pendingEvents().slice(0, 50)) {
        if (this.stopped) break;
        const channel = this.channel;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('Broker confirmation timed out')), 5000);
          const returned = () => finish(new Error('Event was not routed'));
          const closed = () => finish(new Error('Channel closed'));
          function finish(error) { clearTimeout(timer); channel.removeListener('return', returned); channel.removeListener('close', closed); error ? reject(error) : resolve(); }
          channel.once('return', returned); channel.once('close', closed);
          try { channel.publish('robotshop.orders', 'order.paid', Buffer.from(JSON.stringify(event)), { persistent: true, mandatory: true, messageId: event.eventId, type: event.type, contentType: 'application/json' }, finish); }
          catch (error) { finish(error); }
        });
        this.store.eventPublished(event.eventId);
      }
    } catch {
      console.error(JSON.stringify({ service: 'ai-gateway', event: 'order_event_delivery_pending' }));
      this.channel = null;
      try { await this.connection?.close(); } catch {}
      this.connection = null;
    } finally { this.busy = false; }
  }
  async stop() { this.stopped = true; clearInterval(this.timer); try { await this.connection?.close(); } catch {} }
}
