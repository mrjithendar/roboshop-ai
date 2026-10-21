import { serve, json, request, urls } from './lib/runtime.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function diagnostics(check = request, targets = urls) {
  const paths = { cart: '/ready', shipping: '/api/shipping/ready', catalogue: '/api/catalogue/ready',
    agent: '/ready', recommendations: '/ready', users: '/api/users/ready', finder: '/ready' };
  const services = await Promise.all(Object.entries(targets).filter(([name]) => name !== 'sre').map(async ([name, base]) => {
    const start = Date.now();
    const criticality = ['catalogue', 'cart', 'users'].includes(name) ? 'core' : 'feature';
    try { await check(`${base}${paths[name] || '/health'}`, { signal: AbortSignal.timeout(2000) }); return { name, criticality, status: 'healthy', latencyMs: Date.now() - start }; }
    catch { return { name, criticality, status: 'unavailable', latencyMs: Date.now() - start }; }
  }));
  const failed = services.filter(s => s.status !== 'healthy');
  return { checkedAt: new Date().toISOString(), services, status: failed.length ? 'degraded' : 'healthy', mode: 'read-only-runbook', summary: failed.length ? `${failed.map(s => s.name).join(', ')} failed the health probe.` : 'All probed services responded successfully.', nextSteps: failed.length ? ['Inspect the affected service logs.', 'Check service configuration and network connectivity.', 'Restore the dependency and refresh this view.'] : ['No failed health probes. Check metrics and traces when investigating latency.'], actionsExecuted: [] };
}

export function handle(req, res, url) {
  if (req.method !== 'GET') return;
  // The diagnostic workload remains ready even when its monitored targets fail.
  if (url.pathname === '/ready') return json(res, { status: 'ready' });
  if (url.pathname === '/api/ops') return diagnostics(request, { ...urls,
    users: process.env.USER_URL || 'http://127.0.0.1:4109',
    finder: process.env.FINDER_URL || 'http://finder:4110',
  }).then(result => json(res, result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve('sre-copilot', 4104, handle);
