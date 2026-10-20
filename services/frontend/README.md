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

`Dockerfile` builds assets into a private NGINX static server. `frontend-minikube.yaml` exposes port 8080 inside the cluster. The separate edge NGINX proxies browser requests to it and API requests to the gateway.

Native development still serves the compiled frontend through the gateway.
Container gateway images contain only backend code; keep NGINX enabled to serve
the storefront in container deployments.
`src/`, compiler configuration, and README files are not public routes.

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

## Product pages and imagery

`src/product.ts` renders responsive product details, stock and price, quantity selection, cart feedback, specifications, documentation, related cards, and reviews. `src/paths.ts` shares URL resolution, image fallback and purchase eligibility with the storefront. Legacy sale products default missing currency/type to EUR/sale; showcase or synthetic products remain informational. No catalogue prices or inventory are invented. Checkout still requires login.

Original SVG category illustrations in `illustrations/` replace the common placeholder. They are explicitly labelled illustrations rather than actual product photographs. Supplied product images are preserved. Use licensed product-specific photos when available. Both NGINX layers and native gateway development serve these assets.

Verify: `npm run frontend:build`, then `node --test services/frontend/tests/frontend.test.mjs services/frontend/tests/frontend-paths.test.mjs services/frontend/tests/product-page.test.mjs` and `npm run test:nginx`.

Deploy on the Minikube host after syncing changes: `bash build-images.sh` then `bash deploy-minikube.sh --load-images`. Frontend and NGINX must both be rebuilt for the new illustration routes. No data migration is required.

## Cart and checkout pages

`/cart` provides quantity controls and an order summary. `/checkout` provides delivery details, shipping quotes, payment recovery and verified order confirmation. Both use `checkout.html` and `src/checkout.ts`; there is no cart/checkout dialog. With the Minikube ingress these routes are `/roboshop/cart` and `/roboshop/checkout`. Existing `?cart=1` storefront links redirect to the cart page.

The storefront does not initialize payment or shipping controls. Razorpay opens its hosted payment window only after the customer submits payment on checkout. Login, server-calculated totals, inventory reservations and captured-payment verification remain required. A failed reconciliation prevents a new payment until retry succeeds. Synthetic reviews and concept-image labels retain their disclosures.

Rebuild and deploy the frontend, gateway and NGINX changes together using the root build/deploy scripts. No database migration is required.

## Independent service build

Run `docker build -t robotshop-frontend:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).

## My account page

`/account` (`/roboshop/account` behind the Minikube ingress) uses `profile.html` and `src/profile.ts`. The page contains editable personal/contact details, a profile photo, saved delivery addresses, paginated purchase history and recent login activity. Every storefront, product and checkout header includes a My account link.

The client crops uploads to a small JPEG before sending them; the gateway independently validates and normalizes the image. Photos and profile edits persist in MongoDB. Email and roles are read-only here. Address changes do not silently replace checkout shipping details. The page clears private data when the user signs out.

Rebuild/deploy frontend, gateway and NGINX together for the new routes and image-processing dependency. No data reset or account migration is required.

### Shared page layout

Edit `templates/header.html` and `templates/footer.html` to update navigation across all pages. `npm run build` inserts these templates into each page before producing `dist/`; no browser-side layout fetch is needed. Account controls show a generic label, while personal details stay on the account page. The admin page uses a direct account link. Cart counts appear where the page already loads the cart. Shared styles use the `store-` prefix in `styles.css`.
