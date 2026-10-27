# jithendar.com

Next.js 16 (App Router) + MDX publication site. Standing rules: [AGENTS.md](AGENTS.md). Content guide: [docs/CONTENT_MODEL.md](docs/CONTENT_MODEL.md).

Requires Node ≥ 24 (`.nvmrc`). On this Mac, Node 26 is at `/opt/homebrew/bin/node`, but `/usr/local/bin/node` (v20) comes first in `PATH`.

```bash
export PATH=/opt/homebrew/bin:$PATH
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm test
npm run build        # standalone output in .next/standalone
```

| Variable | Purpose |
|---|---|
| `APP_ENV` | `production` allows indexing. Any other value makes every page `noindex`. Set it at **build** time (meta tag) and at **run** time (`X-Robots-Tag`, `robots.txt`). |
| `SITE_URL` | Canonical origin, default `https://jithendar.com`. |
| `CONTENT_DIR` | Optional content root; tests use `tests/fixtures/content`. |

To run the standalone build locally:

```bash
cp -R .next/static .next/standalone/.next/static
cd .next/standalone && APP_ENV=production PORT=3000 node server.js
```

ISR writes to `.next/cache` at runtime. Phase 6 must mount that path as writable.
