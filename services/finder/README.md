# Finder

Optional Python service with an embeddable, framework-free shopping assistant. All
runtime files belong to this directory; there are no sibling source imports.
The browser needs a small JavaScript widget; the HTTP server runs Python/Waitress.

## RobotShop

Every storefront HTML page loads `/finder/widget.js` asynchronously (under
`/roboshop/finder/` on the public site). NGINX routes only this prefix to Finder.
Existing catalogue, account, cart and checkout code does not wait for Finder.
Finder calls the existing gateway and Python shopping-agent for recommendations;
LLM credentials remain in the existing backend configuration. No user cookies,
login tokens or page contents are forwarded. Results link to the store; the widget
does not modify carts or take payments on third-party websites.

```bash
bash build-images.sh --local
bash deploy-minikube.sh

# Disable only Finder; shopping and payment continue independently.
kubectl -n robotshop-ai scale deployment/finder --replicas=0
# Enable again; refresh pages that hid the unavailable widget.
kubectl -n robotshop-ai scale deployment/finder --replicas=1
```

A full deployment reapplies the manifest and enables Finder again. If Finder fails
to become ready, the deployment script reports a warning after deploying the other
services.

New pages show nothing if Finder cannot load. Open visible pages check availability
once every 60 seconds and hide the closed widget after a failure (up to roughly 62 seconds). An active conversation stays visible with a recoverable error and its draft intact.
Health checks are cached server-side for 10 seconds. Hidden tabs do not poll.
After failure polling stops until a page reload. There is a small script/health
request overhead, not zero network cost. Four concurrent verification/chat calls and upstream
timeouts bound the widget's use of the backend. These limits are per replica.
Do not include Finder in another service's readiness checks.

## Embed on another website

Serve Finder behind HTTPS and add the embedding website's **exact origin** to
`ALLOWED_ORIGINS` (comma-separated, without trailing slashes). No wildcard defaults.
Then include:

```html
<script async src="https://jithendar.com/roboshop/finder/widget.js"
        data-label="Find my match"
        data-store="https://jithendar.com/roboshop/"></script>
```

Default branding is “Finder”. `data-store` controls the result links, not the AI's
catalogue. For another catalogue, configure a compatible backend using `CHAT_URL`
and its health endpoints in `HEALTH_URLS`; embedding alone still searches RobotShop.
The backend accepts `POST {"message":"..."}` and returns
`{"answer":"...","products":[{"name":"...","slug":"..."}]}` (SKU is also accepted).
Follow-ups include up to 500 characters of recent questions and suggested names, kept only in the open page. The backend caps the combined request at 1,000 characters. Site CSP must allow the widget origin in `script-src`
and `connect-src`, and inline styles used inside its Shadow DOM. No global CSS,
framework, host DOM scraping or third-party cookies are required. CORS is browser
access control, not authentication; use perimeter rate limits for public production
traffic. This service exposes only the question endpoint, never private admin APIs.

## Configuration and local checks

- `PORT`: `4110`.
- `ALLOWED_ORIGINS`: `https://jithendar.com` by default.
- `CHAT_URL`: `http://ai-gateway:3000/api/chat`.
- `HEALTH_URLS`: `http://ai-gateway:3000/api/status,http://shopping-agent:4103/health`.
- `UPSTREAM_ORIGIN`: `https://jithendar.com`, matching the gateway's configured origin.

```bash
python -m pip install -r requirements.txt
python server.py
python -m unittest discover -s tests -p 'test_*.py'
```

`/health` is process health; `/available` checks verification configuration and the configured backend endpoints.
If hidden, inspect `kubectl -n robotshop-ai logs deployment/finder`, the browser's
network tab, allowed origins, and backend reachability. An unconfigured LLM returns
its configuration notice. No deployment is necessary to build/test the source.

## Required human verification

Finder requires Cloudflare Turnstile for **every question**. The SDK loads only
when the panel opens. The send button stays disabled until verification completes;
a fresh token is required after every submission, including failed requests.
Python validates the token using Siteverify and checks `success`, the `finder`
action, the embedding origin's hostname and a maximum age of five minutes.
Cloudflare rejects reused tokens. Timeout, missing keys, invalid tokens and provider
errors never fall back to unverified chat.

Create a Turnstile widget in your Cloudflare dashboard with `jithendar.com` (and any
other approved embedding hostnames). Use real site/secret keys, not test keys.
Set these existing Kubernetes Secret entries privately:

```bash
kubectl -n robotshop-ai edit secret robotshop-secrets
```

Keep existing `data` entries; add/merge a top-level `stringData` block:

```yaml
stringData:
  TURNSTILE_SITE_KEY: "YOUR_CLOUDFLARE_SITE_KEY"
  TURNSTILE_SECRET_KEY: "YOUR_CLOUDFLARE_SECRET_KEY"
```

Finder also receives the existing `LLM_SERVICE_TOKEN` from that Secret to authenticate
its gateway calls. This value is never sent to browsers. Do not replace it or expose
it in the embed tag. Build/deploy the changed Finder, gateway and NGINX together;
the old public `/api/chat` URL is now blocked at NGINX, and the gateway requires
private service authentication. After a keys-only change:

```bash
kubectl -n robotshop-ai rollout restart deployment/finder
kubectl -n robotshop-ai rollout status deployment/finder
```

For embeddings, permit `https://challenges.cloudflare.com` in CSP `script-src`,
`connect-src` and `frame-src`. RobotShop's CSP already permits these. Add each
embedding origin to `ALLOWED_ORIGINS` and its hostname to the Turnstile widget.
`/available` returns only the public site key; it returns 503 when verification
configuration is missing. `/health` stays independent so misconfiguration does not
restart the process continuously.

Chat attempts are capped at 30/minute per Finder replica, including rejected
attempts, plus four concurrent verification/chat operations. The global limit
avoids trusting spoofable forwarded IP headers; it is intentionally conservative
for this sandbox. For large traffic or several replicas use an edge rate limit
and provider spending limits as well. Human verification reduces automated abuse;
it cannot guarantee that all bots or paid challenge solvers are stopped.

Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Error recovery and verification appearance

Chat errors no longer remove Finder. Verification rejection, throttling and server
failures keep the question available for retry with a fresh token. Open panels
survive availability-check failures; unopened widgets still hide when disabled.
The supported Turnstile `interaction-only` appearance displays its challenge only
when Cloudflare requires interaction. Branding is not cropped or overridden.

A `not-configured` response means the store super admin must test and activate an
LLM provider under the admin LLM settings. Finder cannot generate AI recommendations
without that provider. Provider failures are distinguished from missing configuration.
The shopping agent receives bounded product specifications, can ask clarifying
questions and compare trade-offs using catalogue evidence. No purchase actions or
unverified claims are enabled. Conversation context is untrusted and not persisted
by Finder; questions are still sent to the configured AI provider when active.
