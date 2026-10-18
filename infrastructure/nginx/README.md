# NGINX for RobotShop

NGINX serves the storefront files and sends `/api/*` to the Node AI gateway. The gateway continues to own session cookies, request validation and payment checks. Java shipping, PostgreSQL, Redis and RabbitMQ stay behind the application services.

```text
Browser → NGINX :8080 (HTTP) / :8443 (optional HTTPS)
           ├── /, /app.js, /styles.css, /images/*.png → frontend files
           ├── /api/* → AI gateway :3000 → application services
           ├── /health → NGINX liveness
           └── /ready → gateway /api/ready → dependency readiness
```

## Read the configuration in this order

| File | What it controls |
| --- | --- |
| `nginx.conf` | Worker processes, timeouts, request size, writable temporary paths and included files. |
| `http/05-trusted-load-balancer.conf` | Optional client-IP trust when a known load balancer sits in front of NGINX; disabled by default. |
| `http/10-logging.conf` | JSON access logs with route groups, timings and request IDs. Omits query strings, cookies and bodies from access logs. |
| `http/20-upstream.conf` | Gateway hostname/port, connection reuse and DNS refresh after service replacement. |
| `http/30-compression.conf` | Gzip for public text assets. |
| `http/40-cache-policy.conf` | HTML revalidation, short asset caching, and no-store for APIs/errors. |
| `servers/http.conf` | Default HTTP listener for local use or a TLS-terminating ingress. |
| `servers/https.conf` | Optional HTTPS listener and HTTP-to-HTTPS redirect. |
| `snippets/routes.conf` | Which URLs serve files, proxy requests or return 404. |
| `snippets/proxy.conf` | Forwarding headers, API timeouts and proxy behavior. |
| `snippets/security-headers.conf` | Browser security headers, including the Razorpay-compatible CSP. |
| `start.sh` | Validates settings, renders templates, checks configuration and starts NGINX. |
| `Dockerfile` | Builds the separate `robotshop-nginx` image with frontend assets. |

`http/` files are included inside the main `http` block. One selected server file includes the routes, which include reusable proxy/header settings. `start.sh` substitutes only explicitly listed environment variables, leaving NGINX variables such as `$uri` and `$scheme` intact. Generated configuration lives under `/tmp/robotshop-nginx`; source files remain read-only.

## Start with Compose

Configure the PostgreSQL, Redis and RabbitMQ credentials in the project's `.env` first, as described in the root README. Then, from the repository root:

```sh
docker compose up -d --build
```

Open **http://localhost:3000**. That port now belongs to NGINX; the gateway's port is no longer published. Its internal address remains `ai-gateway:3000`. Existing frontend API paths and the default `PUBLIC_ORIGIN` still work. Rebuild the NGINX image after changing frontend files or configuration.

```sh
docker compose exec nginx nginx -t -c /tmp/robotshop-nginx/nginx.conf
docker compose logs -f nginx
docker compose down
```

`nginx -T` with the same `-c` path prints the complete rendered configuration for learning/debugging. Metrics remain private: Prometheus scrapes `ai-gateway:3000/metrics`, not the public NGINX URL. `npm run dev` still starts the services directly without NGINX; Compose is the integrated NGINX launch path.

## Optional HTTPS

The default HTTP setup does not enable live payment configuration by itself. For NGINX to terminate HTTPS:

1. Obtain a certificate for your hostname. Place `tls.crt` (full chain) and `tls.key` in a directory **outside this repository**; make them readable by container UID/GID 101 without making the private key world-readable.
2. Set `NGINX_SERVER_NAME` and absolute `TLS_CERT_DIR` in `.env`. Certificates are supplied by the operator; this setup does not automate issuance/renewal.
3. Start with the overlay:

```sh
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

The overlay exposes loopback ports 80/443 and sets the gateway/payment `PUBLIC_ORIGIN` to `https://NGINX_SERVER_NAME`. The existing port 3000 also redirects to HTTPS. Hostname DNS/hosts resolution and certificates must match. For an externally reachable deployment, configure the network bindings, DNS and firewall deliberately. After certificate renewal, reload NGINX with `nginx -s reload -c /tmp/robotshop-nginx/nginx.conf`.

The HTTPS server enables HSTS for one year; use a hostname intended to remain HTTPS. The HTTP setup does not send HSTS. If an ingress already handles TLS, keep NGINX in HTTP mode and set `PUBLIC_ORIGIN` to the external HTTPS URL.

## Kubernetes

Build/push the NGINX image separately and set `nginx.image.repository` and `nginx.image.tag`. The chart creates a separate deployment and service named `<release>-nginx`. Point the cluster ingress/load balancer at that service's port 80; the gateway remains private. Two NGINX replicas are enabled by default. This does not change the gateway's existing single-writer constraint.

For TLS termination inside NGINX, provide a Kubernetes TLS Secret through `nginx.tlsSecretName`, set `nginx.serverName`, and set the chart's `publicOrigin` to the matching HTTPS URL. The chart mounts the certificate and exposes service port 443. No ingress controller or public DNS is installed by this chart.

## Proxy and payment behavior

- NGINX overwrites incoming client-IP forwarding headers. `TRUST_PROXY=true` is enabled on the private gateway so its existing limits apply per client rather than per proxy. Do not publish that gateway directly with this flag enabled. Behind a load balancer, configure only its actual trusted CIDRs in `05-trusted-load-balancer.conf`.
- Original host/port, cookies, Origin, trace headers and webhook signature headers pass through. Payment webhook bodies are forwarded unchanged.
- API responses are never cached or compressed, and NGINX does not retry requests automatically. Gateway mutation limits and idempotency remain authoritative.
- `/metrics`, hidden files, source paths and unknown assets are not exposed. Missing assets return 404 rather than the storefront HTML.
- Browser security headers are set at server scope. Adding a location-level `add_header` can suppress inherited headers; keep shared headers in the supplied snippet.

## Tests

`npm run test:nginx` requires NGINX 1.28+ and `envsubst` on the PATH. It starts an isolated temporary proxy and checks assets, caching, cookies, forwarded-header replacement, webhook bytes/signatures, error handling and readiness. Use `NGINX_TEST=true npm test` to run the complete checkout flow through NGINX as well (requires the test PostgreSQL setup).

CI runs these tests using the built NGINX container with host networking on Linux, through `NGINX_TEST_IMAGE=robotshop-nginx:ci`. No real payments are made.
