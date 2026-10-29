# Robotics showcase, reviews and registration

The default seed now contains 30 real robotics products. All are **display-only showcase products**: stock is simulated, fulfilment is simulated, and they cannot enter a cart or payment creation. No demo order calls Razorpay, reserves live stock, or publishes shipping events. The existing live payment implementation remains available for separately configured merchant inventory.

## Catalogue and currency policy

`services/mongodb/catalog.js` (imported into MongoDB) records stable SKUs/slugs, manufacturer/model, product type, original summaries, specifications, core included items, accessory/compatibility notes, official source URLs, checking date, price type and currency, and image permission status. A placeholder is used for every product because permission to reproduce manufacturer photographs was not established. Package lists deliberately identify unverified bundle details; do not interpret them as complete packing lists.

Source review date: **19 October 2026**. The three Pololu prices (Balboa, DRV8833, DRV8835) are USD reference prices from the manufacturer's quantity-one listings, not store offers, delivered prices, or inventory guarantees. Other products show **Price on request**. Their numeric `price: 0` is a legacy schema sentinel, not a free-product price. Never display it as a sale price. Documentation-only entries retain a declared reference currency but have no quoted amount. No exchange rates or conversions are performed.

The EUR checkout accepts only non-showcase, non-synthetic, non-archived products with `currency=EUR` and `priceType=sale`. Legacy merchant records without currency/type retain the existing EUR/sale behavior. Newly created admin products explicitly record those fields. An admin cannot turn a showcase row into live inventory or reprice a source reference through the normal editor. A legitimate inventory item requires a separate SKU and merchant-provided price/stock. Shipping remains EUR. Mixed-currency comparisons omit `lowestPrice`; recommendation budgets default to EUR, with explicit `$`/USD or `₹`/INR restricted to that currency. Unknown prices are excluded from budget results. Sorting groups by currency.

### Provenance

Every product page links to its individual sources. The seed contains original summaries, not copied product descriptions.

- [Pololu official products](https://www.pololu.com/product/3575): 3pi+ assembled/kit, Balboa, Romi chassis/controller, Maestro controllers and motor-driver carriers. Each seed row links to its own numbered product page.
- [Arduino official hardware documentation](https://docs.arduino.cc/hardware/alvik/): Alvik, Engineering Kit Rev2, Nano/UNO boards and motor carriers/shields. Engineering Kit packing scope was cross-checked with the [official FAQ](https://content.arduino.cc/assets/_%20%20Arduino%20Engineering%20Kit%20R2%20FAQ%20%281%29.pdf).
- [Raspberry Pi official products](https://www.raspberrypi.com/products/): Pi 5, Pico 2, Camera Module 3 Standard and AI HAT+ 13 TOPS. Variant/bundle-dependent information is labelled.
- [ROBOTIS TurtleBot3 specifications](https://emanual.robotis.com/docs/en/platform/turtlebot3/features/), [OpenMANIPULATOR-X specifications](https://emanual.robotis.com/docs/en/platform/openmanipulator_x/specification/) and [DYNAMIXEL XL430-W250](https://emanual.robotis.com/docs/en/dxl/x/xl430-w250/).
- [Waveshare RoArm-M2-S](https://www.waveshare.com/product/roarm-m2-s.htm) and [WAVE ROVER](https://www.waveshare.com/product/wave-rover.htm). Variant price ranges were not converted into an invented single price.
- [Elephant Robotics comparison document](https://static.elephantrobotics.com/wp-content/uploads/2022/10/Comparison-of-manipulator.pdf): myCobot 280 M5, myPalletizer 260 M5 and mechArm 270 M5. These specifications explicitly identify the 2022 document edition; current bundle contents and prices are unverified.

### Existing installations

Startup inserts missing SKUs only. It never rewrites administrator edits. Fresh databases receive the curated catalogue directly. To retire the original fictional seed in an existing installation, explicitly run:

This archives only original, unchanged revision-1 rows and inserts absent curated products. Edited legacy rows remain for an admin to review/archive. Orders are not changed or deleted. Rebuild the catalogue-service image first. Source/provenance refreshes require a reviewed migration; restarting does not overwrite existing rows. `CATALOGUE_FILE` is an operator/test fixture override, not a public API.

## Product pages and reviews

Shareable URLs use `/products/<slug>`. Frontend NGINX, edge NGINX and direct gateway development serving allow only this bounded slug pattern. Unknown asset/private paths remain 404. A valid-looking but unknown slug loads the page shell, whose detail API returns 404 and displays a recovery message. HTML shells are not indexed product documents rendered on the server; search-engine metadata is updated by JavaScript.

`GET /api/products/<slug>` returns a product and up to four related products. Ranking uses category, use case and price distance only for comparable currencies/prices, excluding the current, archived and unavailable products.

Reviews live in MongoDB `reviews`, not the JSON commerce ledger. New/edited customer reviews are pending; admin/superadmin moderation sets published/hidden/pending. The product page allows a signed-in user to view, edit or delete only their own review. Admin panel → Review moderation provides separate real/demo lists and moderation actions.

- `GET /api/products/<slug>/reviews?kind=real|demo&after=<cursor>`: 20 records, keyset pagination, separate published rating count/average.
- `GET /api/products/<slug>/reviews/mine`: authenticated user's review, including pending/hidden state.
- `POST`, `PUT`, `DELETE /api/products/<slug>/reviews`: authenticated author only. POST refuses duplicates; PUT resubmits for moderation.
- `GET /api/admin/reviews?kind=real|demo&after=...`, `PATCH /api/admin/reviews/<id>` with `{"status":"published"}`: admin/superadmin only.

Ratings must be integers 1–5; title 3–100 and body 10–2000 characters. Markup/control characters are rejected; browser rendering uses text nodes. Customer input cannot set author, synthetic, moderation or verification fields. Review writes have a persistent 20-attempt/15-minute per-user limit (shared auth-limits mechanism); public requests retain the gateway limit. Aggregates query published rows directly so edits/deletes/moderation cannot leave stale counters.

“Verified purchase” requires a matching authenticated customer/product purchase projection with status paid, captured payment, **live** payment mode, non-synthetic marker and payment date before review creation. Missing historical payment evidence does not earn a badge. Synthetic purchases use `demo_purchases` and are never consulted for genuine verification. A synthetic review never gets the badge.

### Indexes and migration behavior

Gateway startup creates idempotent indexes. Deploy before accepting review traffic; pre-existing duplicates must be resolved explicitly if index creation fails.

| Collection | Index / purpose |
| --- | --- |
| products | Unique slug when stored as a string |
| reviews | Unique `(productId, authorId)`; one review per author/product |
| reviews | `(productId, status, synthetic, _id)` for keyset public pages and aggregates |
| reviews | `(status, _id)` for moderation; `(synthetic, datasetId)` for cleanup |
| purchase_history | `(userId, items.sku, status)` for genuine purchase evidence |
| demo_profiles | `(datasetId, _id)` and unique email |
| demo_purchases | `(datasetId, userId, createdAt)` |
| registration_limits / registration_tokens | TTL on expiresAt; atomic counters/token claims use unique `_id` |

All request pages are bounded to 20 rows. Aggregation executes in MongoDB with a 3-second query budget; full datasets never enter gateway memory. The existing commerce JSON ledger still requires one gateway writer; persistent registration limits are replica-safe but this work does not make that ledger horizontally writable.

## Opt-in synthetic dataset

The seed command is never run at startup, during deployment, or by CI at full size. It uses no LLM, public registration, email, SMS, payment or shipping APIs.

From the repository root, after installing the gateway Python requirements:

```sh
# Read the isolated demo URI without putting credentials in shell history.
read -s 'DEMO_MONGODB_URL?Demo-only MongoDB URI: '; echo
export DEMO_MONGODB_URL
APP_ENV=demo MONGODB_DATABASE=roboshop \
  .venv/bin/python services/catalogue-service/scripts/seed-demo.py seed \
  --database roboshop_demo_showcase --dataset robotics-v1 \
  --random-seed 42 --reviews 30000 --purchase-fraction 0.6
```

The `read` example is for zsh (macOS). In bash use `read -r -s -p 'Demo-only MongoDB URI: ' DEMO_MONGODB_URL; echo`.

This produces **exactly 10,000 profiles**, 30,000 reviews by default, and simulated purchases for a deterministic approximate 60% subset. Reviews are unique per profile/product. All generated rows have `synthetic=true`, `datasetId`, `seedVersion` and `generatedAt`. The reproducible reference date is 2026-10-19, not an observed activity date. Names are synthetic labels, emails are under example.com, and language/country/preferences/account ages are fabricated demo metadata. No IPs, fingerprints, consent or genuine logins are invented. There are **no user/auth-session records or usable credentials**; interactive users must register normally through bot protection.

Demo order amounts use a separate, explicitly illustrative EUR price schedule, not manufacturer USD/EUR source prices. Integer minor units reconcile quantity/line/subtotal/total; shipping is zero and simulated. No provider IDs are created. Reviews linked to delivered demo purchases occur afterwards; dates always follow profile creation.

Writes flush at 250 records per collection. Stable IDs, a configuration/catalogue fingerprint and insert-only upserts make an identical rerun safe after interruption. A different configuration for the same dataset is refused: choose another dataset ID or explicitly clean the old one. Re-running does not undo manual moderation. Do not run cleanup concurrently with a seed.

Only small datasets run in automated tests. The full dataset has **not** been generated or benchmarked as part of implementation. Plan approximately **50–150 MB including indexes and storage overhead**, plus MongoDB's own journal/cache needs; measure on your target. Runtime depends on network and storage, typically a planning allowance of seconds to several minutes rather than a guarantee. The command prints measured elapsed seconds and collection counts after completion. Application memory is bounded by the 30-product catalogue and three 250-write batches.

To browse synthetic reviews, run a **separate demo app** with gateway and ingestion connected to `roboshop_demo_showcase` using its own credentials. Keep live deployment credentials and its ledger volume separate. Set `MONGODB_DATABASE=roboshop_demo_showcase` in that app, not in the seeding process. Choose “Synthetic demo reviews” on a product page. The required synthetic-data notice is prominent, and every generated review is labelled. Demo profiles/purchases are for data exercises and are not exposed through real customer account histories.

Cleanup removes only the selected synthetic dataset from its four collections. It never deletes genuine users, genuine reviews, live purchase history, or reference products:

```sh
APP_ENV=demo MONGODB_DATABASE=roboshop \
  .venv/bin/python services/catalogue-service/scripts/seed-demo.py cleanup \
  --database roboshop_demo_showcase --dataset robotics-v1
unset DEMO_MONGODB_URL
```

The gateway image also contains `/app/services/catalogue-service/scripts/seed-demo.py` and the reference catalogue for an explicit one-off job; no new microservice is introduced.

## Registration bot protection

Implementation follows [Cloudflare's server-side validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): Siteverify is called by the backend, with expected hostname/action and single-use token handling. Tokens expire after five minutes. No browser fingerprinting is used.

Development: `APP_ENV=development REGISTRATION_CHALLENGE_PROVIDER=disabled`. Limits and honeypot remain active. Production requires Turnstile; disabled/unknown provider or missing configuration fails registration closed while the rest of the storefront remains accessible.

Configure a Turnstile widget for the storefront hostname. Set these through your deployment environment/secret management:

```dotenv
APP_ENV=production
REGISTRATION_CHALLENGE_PROVIDER=turnstile
TURNSTILE_SITE_KEY=<public-widget-key>
TURNSTILE_HOSTNAME=shop.example.com
PUBLIC_ORIGIN=https://shop.example.com
TRUSTED_PROXY_CIDRS=<actual-nginx-peer-address-or-cidr>
# Secret-store value, injected into ai-gateway only:
TURNSTILE_SECRET_KEY=<private-provider-secret>
yaml
deploymentEnvironment: production
registration:
  provider: turnstile
  siteKey: <public-widget-key>
  hostname: shop.example.com
  secretName: roboshop-registration
  trustedProxyCidrs: <actual-nginx-pod-cidr>
```

Create `roboshop-registration` using your existing secret manager, with a `TURNSTILE_SECRET_KEY` key. Helm references that key only in ai-gateway; it never renders its value. Existing NGINX CSP permits the official challenge script/frame/connect origin and preserves Razorpay rules. Test a real widget in staging with Cloudflare's [documented test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) before public rollout. Automated tests mock Siteverify; no external challenge verification or paid calls were made.

## Verification

```sh
npm run frontend:build
.venv/bin/python -m unittest discover -s tests/python -v
node --test tests/showcase-ui.test.mjs services/web/frontend/tests/frontend.test.mjs services/web/frontend/tests/admin-ui.test.mjs tests/catalogue.test.mjs
# With disposable MongoDB / PostgreSQL and a built shipping jar:
MONGODB_URL=<isolated-test-uri> npm test
NGINX_TEST=true node --test tests/nginx.test.mjs
```

Tests cover source-schema survival, direct/refresh routes and private-path 404s, mixed-currency restrictions, injected showcase carts blocked before any provider call, related exclusions, review ownership/uniqueness/moderation/aggregates/pagination, genuine versus synthetic verification, challenge failures/timeouts/replay/proxy trust/rate limits, and small deterministic seed/resume/cleanup/production refusal. Existing commerce/auth/admin/MCP/LLM/telemetry regression tests remain in place; fictional fixtures are retained only for those stable regression scenarios.
