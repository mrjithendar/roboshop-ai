# TypeScript storefront

Source lives in `src/app.ts`, `src/account.ts`, and `src/admin.ts`; `tsconfig.json` enables strict checking for DOM controls,
API response contracts, cart/order states and the Razorpay checkout interface. HTML
and CSS remain plain files. No framework or browser-side secrets are required.

From the repository root:

```sh
npm ci
npm run frontend:typecheck
npm run frontend:build
npm run dev
```

The build produces `dist/index.html`, `dist/admin.html`, `dist/styles.css`, and compiled JavaScript modules. `dist/`
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

The account dialog supports email registration/login and logout. Checkout opens
login for anonymous users. `/admin` provides product editing to admins and exposes
user-access/settings sections only to super admins. UI visibility is a convenience;
the gateway independently authorizes every privileged request. Tests in
`tests/admin-ui.test.mjs` exercise all three role views.

Authentication and checkout tests require `MONGODB_URL` pointing to a dedicated test
MongoDB server. They create uniquely named databases (`auth_test_*`, `integration_*`)
and drop only those generated databases afterward. CI supplies MongoDB 8. The tests
never connect to the legacy users database or use a live merchant provider.
`tests/auth.test.mjs` covers server authorization; `tests/admin-ui.test.mjs` covers
role-specific UI behavior. Set shipping owner/runtime URLs as described in the
shipping guide; the Java service initializes its test schema during startup.

Python migration tests: `PYTHON="$PWD/.venv/bin/python" npm run test:python` covers
retrieval, model fallback, password compatibility, ledger/payment invariants,
MCP validation/auth forwarding and HTTP input validation. `npm test` runs Python
unit tests before the Node test harness, which launches the actual Python gateway,
agent and MCP for MongoDB and full HTTP tests. Previous Node modules under
`fixtures/previous-gateway` are compatibility references, not service runtimes.

Customer metadata tests use isolated MongoDB databases and verify retention filters,
address bounds, replay-safe purchase snapshots, account isolation and pagination.
The full integration test also asserts actual Java OTLP protobuf export and
RabbitMQ consumer linkage to the payment trace; private addresses and prompts
must be absent from all captured telemetry payloads.
