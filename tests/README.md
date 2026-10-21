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
sh
bash build-images.sh
bash deploy-minikube.sh
# Storefront: http://localhost:3000
```

Features include search/filter/sort, product details, persistent bag, Java shipping
quotes, verified Razorpay checkout, shopping assistant, and service status. Untrusted
product/model text uses `textContent`. Payment SDK failures are retryable; a 404 for
an expired browser order reference recovers the current session, while network
failures retain the reference. No card details are stored in the browser.

`services/frontend/tests/frontend.test.mjs` executes the compiled application in a DOM environment.
`tests/integration.test.mjs` and `tests/nginx.test.mjs` cover backend flow and HTTP/HTTPS
asset delivery. TypeScript contracts are compile-time checks, not runtime validation
of arbitrary JSON. Real Razorpay acceptance and cross-browser accessibility testing
remain separate release checks.

The account dialog supports email registration/login and logout. Checkout opens
login for anonymous users. `/admin` provides product editing to admins and exposes
user-access/settings sections only to super admins. UI visibility is a convenience;
the gateway independently authorizes every privileged request. Tests in
`services/frontend/tests/admin-ui.test.mjs` exercise all three role views.

Authentication and checkout tests require `MONGODB_URL` pointing to a dedicated test
MongoDB server. They create uniquely named databases (`auth_test_*`, `integration_*`)
and drop only those generated databases afterward. CI supplies MongoDB 8. The tests
never connect to the legacy users database or use a live merchant provider.
`tests/auth.test.mjs` covers server authorization; `services/frontend/tests/admin-ui.test.mjs` covers
role-specific UI behavior. Set shipping owner/runtime URLs as described in the
shipping guide; the Java service initializes its test schema during startup.

Python migration tests: `PYTHON="$PWD/.venv/bin/python" npm run test:python` covers
retrieval, provider configuration and failure handling, password compatibility, ledger/payment invariants,
MCP validation/auth forwarding and HTTP input validation. `npm test` runs Python
unit tests before the Node test harness, which launches the actual Python gateway,
agent and MCP for MongoDB and full HTTP tests. Previous Node modules under
`fixtures/previous-gateway` are compatibility references, not service runtimes.

Customer metadata tests use isolated MongoDB databases and verify retention filters,
address bounds, replay-safe purchase snapshots, account isolation and pagination.
The full integration test also asserts actual Java OTLP protobuf export and
RabbitMQ consumer linkage to the payment trace; private addresses and prompts
must be absent from all captured telemetry payloads.

LLM tests install `tests/python/requirements.txt` in addition to both Python
service requirements. `test_llm.py` mocks MongoDB and provider calls; it verifies
roles/origin checks, revisions, activation/disconnect, allowlists, deadlines and
provider mapping without AWS credentials or a running model server. The dedicated
`llm-checks.yml` workflow runs these tests and the admin/storefront UI tests.

## Robotics showcase

`tests/python/test_showcase.py` covers review security, registration protection, currency and payment isolation. Its MongoDB tests use only 12 profiles/36 reviews and unique `robotshop_demo_test_*` databases. `tests/showcase-ui.test.mjs` exercises product pages with safe DOM rendering. NGINX tests cover direct slug refresh and unknown/private path 404 behavior. Full 10,000-profile seeds are never part of test or deployment startup. See [showcase operations](../docs/deployment/robotics-showcase.md).
