# Curated manufacturer reference collection

**Retired from the public storefront:** reference seeds are no longer imported.
Existing informational records are filtered from catalogue/ingestion reads, including
search, recommendations and AI catalogue consumers. Stored records and historical
orders are retained. The source coverage below is an archival record.

## Coverage and boundaries

Checked on 20 October 2026, with per-record UTC retrieval timestamps. The 20 exact
variants below were checked against Pololu's official product pages. Unit prices
come from those pages' Product/Offer structured data in USD; these are reference
observations, not RoboShop offers. Manufacturer availability is deliberately not
imported. This collection covers six assembled robots, seven kits, five components
and two accessories across Zumo, 3pi+ and Romi. Multiple variants are deliberate:
motor ratio and assembled-versus-kit distinctions must not be lost.

Descriptions are original summaries. Specifications, compatibility and package
notes include only facts present on the cited product page; 3pi+ programming
compatibility also cites the official platform documentation. Unlisted features
are unknown, not absent. No discounts, reviews or warehouse quantities are generated.

| Official item / exact variant | Type | Reference USD |
| --- | --- | ---: |
| [Zumo 2040 Robot (Assembled with 50:1 HP Motors) (item #5011)](https://www.pololu.com/product/5011) | complete robot | 194.95 |
| [Zumo 2040 Robot (Assembled with 75:1 HP Motors) (item #5012)](https://www.pololu.com/product/5012) | complete robot | 194.95 |
| [Zumo 2040 Robot (Assembled with 100:1 HP Motors) (item #5013)](https://www.pololu.com/product/5013) | complete robot | 194.95 |
| [Zumo 2040 Robot Kit (No Motors) (item #5010)](https://www.pololu.com/product/5010) | kit | 129.95 |
| [Zumo 2040 Main Board (item #5014)](https://www.pololu.com/product/5014) | component | 74.95 |
| [Zumo 2040 Front Sensor Array (item #5015)](https://www.pololu.com/product/5015) | component | 24.95 |
| [Zumo Windowed Blade (for 32U4/2040) (item #3121)](https://www.pololu.com/product/3121) | accessory | 6.95 |
| [3pi+ 2040 Robot - Standard Edition (30:1 MP Motors), Assembled (item #5001)](https://www.pololu.com/product/5001) | complete robot | 194.95 |
| [3pi+ 2040 Robot - Turtle Edition (75:1 LP Motors), Assembled (item #5002)](https://www.pololu.com/product/5002) | complete robot | 194.95 |
| [3pi+ 2040 Robot - Hyper Edition (15:1 HPCB Motors), Assembled (item #5000)](https://www.pololu.com/product/5000) | complete robot | 208.95 |
| [3pi+ 2040 Robot Kit with 30:1 MP Motors (Standard Edition Kit) (item #5004)](https://www.pololu.com/product/5004) | kit | 179.95 |
| [3pi+ 2040 Robot Kit with 75:1 LP Motors (Turtle Edition Kit) (item #5005)](https://www.pololu.com/product/5005) | kit | 179.95 |
| [3pi+ 2040 Robot Kit with 15:1 HPCB Motors (Hyper Edition Kit) (item #5003)](https://www.pololu.com/product/5003) | kit | 193.95 |
| [3pi+ 2040 Control Board (item #5006)](https://www.pololu.com/product/5006) | component | 74.95 |
| [Robot Arm Kit for Romi (item #3550)](https://www.pololu.com/product/3550) | kit | 99.95 |
| [Romi Chassis Expansion Plate - Black (item #3560)](https://www.pololu.com/product/3560) | accessory | 6.49 |
| [Romi Encoder Pair Kit, 12 CPR, 3.5-18V (item #3542)](https://www.pololu.com/product/3542) | kit | 9.95 |
| [Romi 32U4 Control Board (item #3544)](https://www.pololu.com/product/3544) | component | 74.95 |
| [Motor Driver and Power Distribution Board for Romi Chassis (item #3543)](https://www.pololu.com/product/3543) | component | 34.95 |
| [Zumo Chassis Kit (No Motors) (item #1418)](https://www.pololu.com/product/1418) | kit | 23.49 |

Every listing has manufacturer, exact model/item ID, type, original description,
verified specifications and compatibility, price/currency/type/source/check time,
source links, image attribution and unresolved fields. All 20 currently have a
source price; if a future price cannot be verified, use `priceType: on-request`,
`price: 0` (legacy storage sentinel, **not free**) and explain the gap in `priceBasis`.
The UI renders “Price on request”; unknown prices are excluded from budget matches
and numeric comparisons. No conversion to INR is performed.

## Unresolved fields

All 20 lack a genuine RoboShop merchant sale price, integrated warehouse stock,
fulfilment integration, verified destination taxes/shipping and confirmed permission
to reuse manufacturer photographs. Every row lists these gaps explicitly. They use
existing repository category illustrations with visible captions and descriptive alt
text, not copied photos or purported images of the exact model. `instock: 0` is a
non-sale sentinel, not a claim that the manufacturer is out of stock. Both inventory
and fulfilment are marked simulated. Prices are dated observations and can change.

## Import and review contract

`services/product-ingestion/reference-products.json` owns this collection. The
intentional concept/demo collection remains in `products.json`; the earlier
`showcase-reference.json` fixture is retained and is **not** imported or recertified
by this update. Existing older showcase rows are labeled `legacy-reference` on read;
no historical rows are silently archived. Some earlier rows may describe the same
manufacturer products; deciding which to retire needs an explicit reviewed change.

On product-ingestion startup, `seedProducts()` validates the complete batch before
writing and performs `$setOnInsert` upserts keyed by SKU. Publishing calls the same
function. Repeating either operation does not overwrite administrator edits, price,
stock, revision or archive decisions. There is no automatic supplier sync. A unique
slug index protects product URLs. `CATALOGUE_FILE` can replace the demo seed input;
the reference file is still independently validated and inserted.

The public namespace `REF-` is reserved for these imports. Validation rejects sale
price types, nonzero stock, merchant fulfilment, incomplete identity/evidence,
missing timestamps and unreviewed image paths. Regular admin price edits cannot
change a reference price or make its stock nonzero. The gateway independently
blocks reference collection/SKU purchases even with forged sale/showcase flags.
Demo checkout remains test-only under the existing payment provenance checks.

To update an existing reference, review its exact variant, primary source and
license first. Prepare a data change with refreshed evidence and a reason, then use
an explicit reviewed database update conditional on the current `revision`, record
the reviewer/time/reason and increment revision. No bulk-overwrite switch is provided.
Changing the seed alone affects only new installations/missing SKUs; it intentionally
does not overwrite an existing row. Orders and pending payment snapshots are never
repriced, re-currencied or otherwise rewritten by imports.

## Presentation and AI

The storefront has separate collection filters and visible reference/demo badges.
Reference detail pages display source links, check date, reference-price caveat,
simulated inventory, compatibility and unresolved fields, with checkout disabled.
Budget retrieval requires matching currency and a known price; unknown prices are
not treated as zero-cost offers. Price sorting groups currency and price type.
Related products favor the same collection and can include zero-stock reference
listings. Comparison returns `lowestPrice: null` across different currency, price
type or collection and supplies its comparison policy alongside the original rows.

AI evidence includes manufacturer/model, source price type and URL/date, collection,
fulfilment, inventory status, compatibility, verified specifications and unresolved
fields. Instructions forbid converting a reference/demo observation into a merchant
offer. Language-model output remains generated guidance; the server-side purchase
checks are authoritative.

## Verification and deployment

Mocked import tests cover repeat runs and preservation of edited/archived/unrelated
merchant rows. Validation tests run against each independently packaged catalogue
library. Gateway tests cover retrieval, comparison, injected-cart checkout rejection
and captured AI evidence. Browser DOM tests exercise reference pages and collection
filters, price labels and image captions. No real supplier purchase or payment is
performed. MongoDB integration requires the configured database and is not implied
by the in-memory import tests.

Release product-ingestion, catalogue-service, recommendation-service, moks,
ai-gateway and frontend through their normal CI workflows, then Deploy-Minikube.
Publication is additive; it inserts the reference rows without replacing demo data.

## Deployment publication

Deploy-Minikube applies and restarts product-ingestion. Its startup calls
`seedProducts(db)` before opening the HTTP listener, inserting missing listings
without changing existing products. The workflow does not also execute
`publish-catalogue.mjs` inside the restarting container: with the Recreate strategy
that can fail with `container not found ("product-ingestion")`.
Ingress and TLS configuration has its own apply step. No rollout waits are added;
a successful workflow means commands were submitted, not that publication or
certificate issuance has completed. If products remain missing, inspect
`kubectl -n roboshop-ai logs deployment/product-ingestion --tail=100` and pod
status for image-pull, MongoDB or startup validation errors. Fix those errors and
restart product-ingestion to retry the insert-only publication.
