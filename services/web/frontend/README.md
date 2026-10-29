# TypeScript storefront

Source lives in `src/app.ts`, `src/account.ts`, and `src/admin.ts`; `tsconfig.json` enables strict checking for DOM controls,
API response contracts, cart/order states and the Razorpay checkout interface. HTML
and CSS remain plain files. No framework or browser-side secrets are required.

From the repository root:

```sh
npm ci
npm run frontend:typecheck
npm run frontend:build
```

The build produces `dist/index.html`, `dist/admin.html`, `dist/styles.css`, and compiled JavaScript modules. `dist/`
is ignored by Git. Never edit generated JavaScript. Rebuild after source edits (there is no watch server).

## Deployment

`../Dockerfile` builds these assets and packages them with the NGINX configuration in `../nginx` as one `web` image; the same container serves the pages and proxies API requests to the gateway. See [../README.md](../README.md).

Native development still serves the compiled frontend through the gateway.
Container gateway images contain only backend code; the `web` image serves
the storefront in container deployments.
`src/`, compiler configuration, and README files are not public routes.

Features include search/filter/sort, product details, persistent bag, Java shipping
quotes, verified Razorpay checkout, shopping assistant, and service status. Untrusted
product/model text uses `textContent`. Payment SDK failures are retryable; a 404 for
an expired browser order reference recovers the current session, while network
failures retain the reference. No card details are stored in the browser.

`services/web/frontend/tests/frontend.test.mjs` executes the compiled application in a DOM environment.
`tests/integration.test.mjs` and `tests/nginx.test.mjs` cover backend flow and HTTP/HTTPS
asset delivery. TypeScript contracts are compile-time checks, not runtime validation
of arbitrary JSON. Real Razorpay acceptance and cross-browser accessibility testing
remain separate release checks.

The account dialog supports email registration/login and logout. Checkout opens
login for anonymous users. `/admin` provides product editing to admins and exposes
user-access/settings sections only to super admins. UI visibility is a convenience;
the gateway independently authorizes every privileged request. Tests in
`services/web/frontend/tests/admin-ui.test.mjs` exercise all three role views.

## Product pages and imagery

`src/product.ts` renders responsive product details, stock and price, quantity selection, cart feedback, specifications, documentation, related cards, and reviews. `src/paths.ts` shares URL resolution, image fallback and purchase eligibility with the storefront. Legacy sale products default missing currency/type to EUR/sale; showcase or synthetic products remain informational. No catalogue prices or inventory are invented. Checkout still requires login.

Original SVG category illustrations in `illustrations/` replace the common placeholder. They are explicitly labelled illustrations rather than actual product photographs. Supplied product images are preserved. Use licensed product-specific photos when available. The web NGINX and native gateway development serve these assets.

Verify: `npm run frontend:build`, then `node --test services/web/frontend/tests/frontend.test.mjs services/web/frontend/tests/frontend-paths.test.mjs services/web/frontend/tests/product-page.test.mjs` and `npm run test:nginx`.

Rebuild and deploy the `web` image for new routes or assets. No data migration is required.

## Cart and checkout pages

`/cart` provides quantity controls and an order summary. `/checkout` provides delivery details, shipping quotes, payment recovery and verified order confirmation. Both use `checkout.html` and `src/checkout.ts`; there is no cart/checkout dialog. With the Minikube ingress these routes are `/roboshop/cart` and `/roboshop/checkout`. Existing `?cart=1` storefront links redirect to the cart page.

The storefront does not initialize payment or shipping controls. Razorpay opens its hosted payment window only after the customer submits payment on checkout. Login, server-calculated totals, inventory reservations and captured-payment verification remain required. A failed reconciliation prevents a new payment until retry succeeds. Synthetic reviews and concept-image labels retain their disclosures.

Rebuild and deploy the web and gateway images together. No database migration is required.

## Image

This directory is built by `services/web/Dockerfile` (context `services/web`); there is no separate frontend image.

## My account page

`/account` (`/roboshop/account` behind the Minikube ingress) uses `profile.html` and `src/profile.ts`. The page contains editable personal/contact details, a profile photo, saved delivery addresses, paginated purchase history and recent login activity. Every storefront, product and checkout header includes a My account link.

The client crops uploads to a small JPEG before sending them; the gateway independently validates and normalizes the image. Photos and profile edits persist in MongoDB. Email and roles are read-only here. Address changes do not silently replace checkout shipping details. The page clears private data when the user signs out.

Rebuild/deploy web and the gateway together for the new routes and image-processing dependency. No data reset or account migration is required.

### Shared page layout

Edit `templates/header.html` and `templates/footer.html` to update navigation across all pages. `npm run build` inserts these templates into each page before producing `dist/`; no browser-side layout fetch is needed. Account controls show a generic label, while personal details stay on the account page. The admin page uses a direct account link. Cart counts appear where the page already loads the cart. Shared styles use the `store-` prefix in `styles.css`.

Sign-in and registration use `/login` and `/register` (under the configured storefront prefix). Both render `auth.html` with `auth.ts`; there is no account modal or action dropdown. Successful authentication returns to an allowlisted storefront route supplied by `returnTo`, defaulting to `/account`. Add new routes to `../nginx/snippets/routes.conf` and redeploy web.

Both login and registration require a Turnstile challenge when the authentication provider is `turnstile`. Actions are `login` and `register`, validated on the gateway before credential checks. The Minikube configuration enables this provider and reads the shared Turnstile keys from `roboshop-secrets`.

Cart currency follows the saved storefront selection, or the currency service's browser-region
suggestion on direct entry. The selector offers currencies enabled for checkout. Guest carts
use a separate, explicitly estimated display snapshot; signing in obtains an authoritative
signed payment quote. FX failure keeps source prices with an explanation. Existing reserved
payments keep their immutable currency and amount, even if the display preference changes.

The shared header has the only currency selector: INR, USD, GBP, SGD and AUD.
The initial choice uses the browser region hint returned by the currency service;
unsupported regions default to INR. Manual choices persist across pages in this browser.
Catalogue source currencies remain unchanged. Cart/checkout use the same selection;
currencies not enabled by the payment service are disabled, and reserved orders keep
their original currency. Conversion failures show original amounts rather than relabeling them.

The header uses a directly accessible native currency dropdown beside account and cart controls, with no popup button. Narrow screens place these actions on their own row.

## Typography, theme and rebranding

The site uses Inter, self-hosted from `fonts/` (SIL Open Font License 1.1, see `fonts/LICENSE`); no third-party font requests are made, so the `default-src 'self'` CSP is unchanged. `/fonts/inter-latin(-ext).woff2` is routed by the web NGINX and the native gateway.

Brand colours, text colours, font stack and header height are CSS custom properties on `:root` in the "Enterprise theme" block at the end of `styles.css`; change `--brand*` there to rebrand. The store name and announcement come from admin Store settings. The header logo mark is drawn in CSS, so it survives the runtime store-name replacement. `npm run build` marks the current section in the header with `aria-current="page"`.

## Admin product editing

Product images are uploaded (file picker or drag and drop); the browser resizes to 1600 px and the gateway re-encodes and stores them. Standard categories are checkboxes matching the storefront filters, with a free-text box for extra categories. Fields the gateway would refuse are locked: images for reference products, and stock when the PostgreSQL commerce backend requires audited inventory adjustments. Super admins also get Orders (search, filters, test-order reconciliation with a reason) and Activity (the admin audit log) tabs.
