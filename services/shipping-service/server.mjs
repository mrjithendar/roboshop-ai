import { serve, json, body } from '../shared/runtime.mjs';
import { Locations } from './database.mjs';
const locations = new Locations();
await locations.ready();
serve('shipping-service', 4106, async (req, res, url) => {
  if (url.pathname === '/api/shipping/ready') { await locations.ready(); return json(res, { status: 'ok' }); }
  if (req.method === 'GET' && url.pathname === '/api/shipping/countries') return json(res, { countries: await locations.countries(), source: 'GeoNames', license: 'CC BY 4.0' });
  if (req.method === 'GET' && url.pathname === '/api/shipping/cities') return json(res, { cities: await locations.search(url.searchParams.get('country'), url.searchParams.get('q')) });
  if (req.method === 'POST' && url.pathname === '/api/shipping/quote') return json(res, await locations.quote(await body(req)));
});
