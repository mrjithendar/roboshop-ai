import { createInterface } from 'node:readline';
import { request, urls } from '../shared/runtime.mjs';

const tools = [
  { name: 'search_products', description: 'Read in-stock catalogue recommendations. No cart or order mutations.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'service_health', description: 'Read current service health probes and runbook suggestions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
];
let initialized = false;
export async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (!Object.hasOwn(message, 'id')) return null;
  const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize') {
    initialized = true;
    return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'robotshop-readonly', version: '0.1.0' } });
  }
  if (message.method === 'ping') return reply({});
  if (!initialized) return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'Initialize first' } };
  if (message.method === 'tools/list') return reply({ tools });
  if (message.method === 'tools/call') {
    const { name, arguments: args = {} } = message.params || {};
    try {
      let result;
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments.');
      if (name === 'search_products') {
        if (typeof args.query !== 'string' || args.query.length > 1000 || Object.keys(args).some(k => k !== 'query')) throw new Error('Invalid query.');
        result = await request(`${urls.recommendations}/api/recommendations?q=${encodeURIComponent(args.query)}`);
      } else if (name === 'service_health' && Object.keys(args).length === 0) result = await request(`${urls.sre}/api/ops`);
      else throw new Error('Unknown tool or arguments.');
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
    } catch { return reply({ content: [{ type: 'text', text: 'Tool unavailable or arguments invalid.' }], isError: true }); }
  }
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    if (line.length > 16384) throw new Error();
    const response = await handle(JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); }
}
