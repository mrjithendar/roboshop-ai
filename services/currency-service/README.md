# Currency display service

This independent Go service (standard library only) provides estimated local-currency catalogue prices using the [ECB daily reference feed](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). No API key, database, or shared service package is required. ECB rates are informational, not transaction quotes.

`GET /rates?country=IN` returns EUR-based rates, source URL, rate date, stale flag and a suggested currency for supported ISO country codes. Cross conversion is `amount / rates[source] * rates[target]`. The browser formats target currency precision using Intl. Country is a display hint only and cannot affect payment or authorization. No visitor data is sent to the ECB.

A background goroutine downloads the fixed HTTPS feed hourly with a five-second total request deadline and 64 KiB response limit. Requests only read cached data; they never cause upstream requests. Caches are independent per replica, start empty, and tolerate refresh failures for at most seven calendar days from the rate date. After two hours without a successful refresh the cached rate is labelled stale. Missing/expired rates return 503. Only feed-supported currencies are offered; unsupported currencies are never assigned invented rates.

Liveness `/health` checks the process. Readiness `/ready` checks for usable cached rates. The service is optional and is not included in storefront readiness. NGINX exposes `/api/currency/rates` (also beneath the existing `/roboshop` ingress prefix), uses runtime DNS and bounded timeouts, and strips cookies and authorization headers.

Catalogue, recommended and related-product prices use browser region as a country hint, with India timezone detection for browsers configured as en-US. This is not verified IP geolocation. Visitors can override the currency in the catalogue/product header; the choice is saved locally. Unknown regions default to INR when supported; unsupported regions do not receive a guessed location-specific currency. No precise-location permission or IP-geolocation service is used. On failure, original prices stay visible with an unavailable notice.

Converted amounts are labelled approximate with their original amount and rate date. Reference listings stay reference listings, demo labels remain, and unknown prices stay “Price on request”. Sorting/search budgets retain source-currency rules. Cart, shipping, checkout, Razorpay, order history and AI evidence retain original amounts/currencies. This feature does **not** implement multi-currency payment settlement or overwrite USD reference data. Checkout clearly uses its cart currency; exchange estimates are never submitted as payable totals.

## Build and deployment

The service has its own `Dockerfile`, `currency-service-minikube.yaml`, and `ci-currency-service.yml` workflow. The existing reusable publisher builds `robotshop-currency-service:latest` in ECR. The Terraform ECR list includes its repository; apply infrastructure before publishing the new image. Publish currency-service, frontend and nginx images, then run Deploy-Minikube. It applies/restarts this optional service without adding rollout waits. No new secrets or ConfigMaps are needed. Outbound HTTPS to the ECB must be available.

Local tests (no live rate requests):

```sh
(cd services/currency-service && go test -race ./...)
npm --prefix services/frontend test
```

For a local service run: `cd services/currency-service && go run .` (port 4111). This starts the real ECB refresh; tests mock it. Payment services never call this service.
