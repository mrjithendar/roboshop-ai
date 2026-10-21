# Finder

Optional Python shopping assistant with an isolated, embeddable widget. Storefront
pages load `/finder/widget.js` asynchronously, under `/roboshop/` on the public site.
The store does not wait for Finder, and disabling it does not interrupt shopping.

## Login required

Guests see **Please sign in to use Finder** and a sign-in link. The question form
is hidden. `/chat` validates the `rs_auth` session with the gateway on every request
and returns HTTP 401 with `code: login-required` for missing, expired, revoked or
invalid sessions. Gateway failures also deny access. Guest verification passes and
Cloudflare challenge tokens do not grant chat access.

Finder does not load Turnstile or need its keys. Login and registration perform
Cloudflare verification through the authentication service. Finder's Minikube
manifest only requires `LLM_SERVICE_TOKEN` for its private chat connection.

Same-origin widget requests include the login cookie. Finder forwards only
`rs_auth` to the configured `AUTH_URL` (default
`http://ai-gateway:3000/api/auth/me`), never to the LLM. `/available` returns only
availability and an authenticated boolean, with `Cache-Control: no-store`.

External embeddings omit cookies and show a link to the store's login page; they
cannot reuse the store session across origins. The universal widget can be served
behind another website's same-origin proxy with its own compatible authentication
endpoint. CORS allowlisting alone does not authorize chat.

## Embed

```html
<script async src="https://jithendar.com/roboshop/finder/widget.js"
        data-store="https://jithendar.com/roboshop/" data-label="Finder"></script>
```

`data-store` controls the sign-in and product links. Same-origin sign-in links
preserve the current page in `returnTo`; the login page validates that destination.
The widget uses Shadow DOM, never scrapes page contents, and never modifies carts
or initiates payments.

## Configuration

- `CHAT_URL`: private gateway chat URL; default `http://ai-gateway:3000/api/chat`.
- `AUTH_URL`: gateway session-validation URL, described above.
- `UPSTREAM_ORIGIN`: store origin, default `https://jithendar.com`.
- `ALLOWED_ORIGINS`: comma-separated widget origins.
- `LLM_SERVICE_TOKEN`: private service credential, at least 32 characters.
- `HEALTH_URLS`: comma-separated backend health URLs.
- `PORT`: service port, default `4110`.

An active LLM provider must be configured and tested in the store's admin panel.
Finder distinguishes `not-configured` from provider failures. Questions and bounded
follow-up context go to the shopping agent; secrets and cookies are not included.

## Failure handling

A service outage hides a closed widget; an open conversation retains its draft
and shows an error. Availability is checked once per visible minute and when the
panel opens. Chat errors preserve the question for retry. Expired login sessions
hide chat controls and display the sign-in prompt. Conversation state stays in
page memory only.

Requests are limited to 30 attempts per minute per replica, four concurrent chat
requests, 1,000 characters per question and 500 characters of optional context.
Production deployments should also enforce edge rate limits and provider budgets.
`/health` reports process health. `/ready` checks service-token configuration and
only the gateway status, shopping-agent readiness and user-service readiness, with
a 1.5-second probe budget and ten-second cache. At most three operator-configured
`HEALTH_URLS` are accepted. `/available` adds the visitor's authenticated state.
No readiness probe invokes a model or bills tokens; actual inference failures
return HTTP 503 with `code: feature-unavailable`. Finder never gates gateway or
NGINX readiness. Direct public `/api/chat` access is blocked by Nginx.

## Build and deploy

```bash
bash build-images.sh --service finder --local
bash deploy-minikube.sh --service finder --load-images
```

The Nginx Finder route must forward cookies for same-origin session validation.
Tests: `python3 -m unittest discover -s services/finder/tests` and
`node --test services/finder/tests/widget.test.mjs`.
