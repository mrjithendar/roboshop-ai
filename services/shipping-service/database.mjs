import { readFileSync } from 'node:fs';
import { createPool } from './pool.mjs';
import { HttpError, text } from '../shared/runtime.mjs';

export function distanceKm(lat, lon, originLat = 51.164896, originLon = 7.068792) {
  const rad = n => n * Math.PI / 180;
  const a = Math.sin(rad(lat - originLat) / 2) ** 2 + Math.cos(rad(originLat)) * Math.cos(rad(lat)) * Math.sin(rad(lon - originLon) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))));
}
export class Locations {
  constructor(pool = createPool()) { this.db = pool; }
  async ready() {
    const result = await this.db.query("SELECT value FROM shipping.metadata WHERE key='seed'");
    const manifest = JSON.parse(readFileSync(new URL('./data/manifest.json', import.meta.url)));
    if (result.rows[0]?.value !== manifest.sha256) throw new Error('Run npm run shipping:migrate before starting shipping');
  }
  async countries() { return (await this.db.query('SELECT code, name, (SELECT count(*)::integer FROM shipping.cities WHERE country_code=code) AS "cityCount" FROM shipping.countries ORDER BY name')).rows; }
  async search(code, query) {
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || !(await this.db.query('SELECT code FROM shipping.countries WHERE code=$1', [code])).rowCount) throw new HttpError(400, 'Select a valid country.');
    query = text(query, 'City search', 80).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (query.length < 2) throw new HttpError(400, 'Enter at least two characters.');
    return (await this.db.query('SELECT id, country_code AS "countryCode", name, region FROM shipping.cities WHERE country_code=$1 AND search_name >= $2 AND search_name < $3 ORDER BY search_name,id LIMIT 30', [code, query, query + '\uffff'])).rows;
  }
  async quote(data) {
    if (!Number.isSafeInteger(data.cityId) || data.cityId < 1) throw new HttpError(400, 'Select a city from the search results.');
    const city = (await this.db.query('SELECT cities.id, cities.name, region, latitude, longitude, country_code AS "countryCode", countries.name AS country FROM shipping.cities JOIN shipping.countries ON countries.code=cities.country_code WHERE cities.id=$1', [data.cityId])).rows[0];
    if (!city) throw new HttpError(404, 'City not found.');
    const address = { recipient: text(data.recipient, 'Recipient', 100), line1: text(data.line1, 'Street address', 200), postalCode: typeof data.postalCode === 'string' ? data.postalCode.trim() : '' };
    if (address.postalCode.length > 20 || Object.values(address).some(v => /[\x00-\x1f\x7f]/.test(v))) throw new HttpError(400, 'Invalid delivery address.');
    const distance = distanceKm(city.latitude, city.longitude);
    return { city, address, distanceKm: distance, cost: distance * 5 / 100, currency: 'EUR', method: 'Distance-based standard shipping', quotedAt: new Date().toISOString() };
  }
  close() { return this.db.end(); }
}
