# TypeScript storefront

Source lives in `src/app.ts`; `tsconfig.json` enables strict checking for DOM controls,
API response contracts, cart/order states and the Razorpay checkout interface. HTML
and CSS remain plain files. No framework or browser-side secrets are required.

From the repository root:

```sh
npm ci
npm run frontend:typecheck
npm run frontend:build
npm run dev
```

The build produces `dist/index.html`, `dist/styles.css`, and `dist/app.js`. `dist/`
is ignored by Git. Never edit generated JavaScript. Rebuild after source edits;
`npm run dev` builds once on startup and does not provide a watch server.

## Deployment

`../nginx/Dockerfile` compiles the storefront in a Node build stage and copies only
the generated public assets into the NGINX runtime. `../nginx/compose.yml` owns its
Compose deployment, extended by root `docker-compose.yml`. The Helm chart's `nginx`
Deployment uses this same image. There is intentionally one web-serving process:
NGINX serves the frontend and proxies `/api/*` to the private gateway.

The root Node Dockerfile also builds the frontend for direct gateway development
and Helm deployments with NGINX disabled. Both paths use the same build script.
`src/`, compiler configuration, and README files are not public routes.

```sh
docker compose up -d --build nginx
# Storefront: http://localhost:3000
```

Features include search/filter/sort, product details, persistent bag, Java shipping
quotes, verified Razorpay checkout, shopping assistant, and service status. Untrusted
product/model text uses `textContent`. Payment SDK failures are retryable; a 404 for
an expired browser order reference recovers the current session, while network
failures retain the reference. No card details are stored in the browser.

`tests/frontend.test.mjs` executes the compiled application in a DOM environment.
`tests/integration.test.mjs` and `tests/nginx.test.mjs` cover backend flow and HTTP/HTTPS
asset delivery. TypeScript contracts are compile-time checks, not runtime validation
of arbitrary JSON. Real Razorpay acceptance and cross-browser accessibility testing
remain separate release checks.
