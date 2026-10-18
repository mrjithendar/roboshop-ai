// Test-only provider: injected in-process, never reachable through production configuration.
import { Razorpay } from '../../services/payment-service/razorpay.mjs';
import { startPaymentService } from '../../services/payment-service/server.mjs';
const config = { PAYMENT_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_INTEGRATION', RAZORPAY_KEY_SECRET: 'test-payment-secret', RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret', PAYMENT_SERVICE_TOKEN: process.env.PAYMENT_SERVICE_TOKEN };
let order;
const payment = () => ({ id: 'pay_INTEGRATION', order_id: order.id, amount: order.amount, currency: order.currency, captured: true, status: 'captured', amount_refunded: 0 });
const provider = new Razorpay(config, async (url, options) => {
  let result;
  if (options.method === 'POST') { order = { ...JSON.parse(options.body), id: 'order_INTEGRATION', status: 'created' }; result = order; }
  else if (url.endsWith('/payments/pay_INTEGRATION')) result = payment();
  else if (url.endsWith('/payments')) result = { items: [payment()] };
  else result = { ...order, status: 'paid' };
  return { ok: true, json: async () => result };
});
startPaymentService(provider);
