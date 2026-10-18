import { serve, json, body, text, request, urls, context } from '../shared/runtime.mjs';
import { answer } from './agent.mjs';

serve('shopping-agent', 4103, async (req, res, url) => {
  if (req.method !== 'POST' || url.pathname !== '/api/chat') return;
  const data = await body(req);
  const message = text(data.message, 'Message');
  const { products } = await request(`${urls.catalogue}/api/products`);
  // Only the internal gateway supplies availability overrides from its demo ledger.
  const unavailable = Array.isArray(data.unavailableSkus) ? data.unavailableSkus.filter(s => typeof s === 'string') : [];
  const result = await answer(products.filter(p => !unavailable.includes(p.sku)), message);
  Object.assign(context.getStore().attributes, { 'robotshop.assistant.mode': result.mode, 'langfuse.observation.type': result.mode === 'ai' ? 'generation' : 'span', ...(result.model ? { 'gen_ai.request.model': result.model, 'gen_ai.system': 'openai', 'gen_ai.usage.input_tokens': result.usage?.input_tokens || 0, 'gen_ai.usage.output_tokens': result.usage?.output_tokens || 0 } : {}) });
  json(res, result);
});
