import { serve, json, request, urls } from '../shared/runtime.mjs';

serve('sre-copilot', 4104, async (req, res, url) => {
  if (req.method !== 'GET' || url.pathname !== '/api/ops') return;
  const services = await Promise.all(Object.entries(urls).filter(([name]) => name !== 'sre').map(async ([name, base]) => {
    const start = Date.now();
    try { await request(`${base}${name === 'shipping' ? '/api/shipping/ready' : name === 'catalogue' ? '/api/catalogue/ready' : '/health'}`, { signal: AbortSignal.timeout(2000) }); return { name, status: 'healthy', latencyMs: Date.now() - start }; }
    catch { return { name, status: 'unavailable', latencyMs: Date.now() - start }; }
  }));
  const failed = services.filter(s => s.status !== 'healthy');
  json(res, { checkedAt: new Date().toISOString(), services, status: failed.length ? 'degraded' : 'healthy', mode: 'read-only-runbook', summary: failed.length ? `${failed.map(s => s.name).join(', ')} failed the health probe.` : 'All probed services responded successfully.', nextSteps: failed.length ? ['Inspect the affected service logs.', 'Check service configuration and network connectivity.', 'Restore the dependency and refresh this view.'] : ['No failed health probes. Check metrics and traces when investigating latency.'], actionsExecuted: [] });
});
