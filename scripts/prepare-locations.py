"""Normalize downloaded GeoNames files; no network needed during application startup.
Usage: python3 scripts/prepare-locations.py cities15000.zip countryInfo.txt
"""
import gzip, hashlib, json, pathlib, sys, zipfile
archive, countries_file = map(pathlib.Path, sys.argv[1:])
countries = []
for line in countries_file.read_text().splitlines():
    if not line or line.startswith('#'): continue
    r = line.split('\t')
    countries.append([r[0], r[4]])
known = {r[0] for r in countries}
cities = []
with zipfile.ZipFile(archive) as z:
    for line in z.read('cities15000.txt').decode().splitlines():
        r = line.split('\t')
        if r[8] in known:
            cities.append([int(r[0]), r[8], r[1], r[2], r[10], float(r[4]), float(r[5])])
payload = {'countries': countries, 'cities': cities}
out = pathlib.Path(__file__).resolve().parents[1] / 'services/shipping-service/data'
out.mkdir(parents=True, exist_ok=True)
raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
(out / 'locations.json.gz').write_bytes(gzip.compress(raw, mtime=0))
(out / 'manifest.json').write_text(json.dumps({'source': 'GeoNames', 'license': 'CC BY 4.0', 'countries': len(countries), 'cities': len(cities), 'countriesWithCities': len({r[1] for r in cities}), 'sha256': hashlib.sha256(raw).hexdigest(), 'inputs': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (archive, countries_file)}}, indent=2) + '\n')
print((out / 'manifest.json').read_text())
