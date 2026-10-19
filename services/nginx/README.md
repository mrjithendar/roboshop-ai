# NGINX for RobotShop

NGINX serves the storefront files and sends `/api/*` to the Python AI gateway. The gateway continues to own session cookies, request validation and payment checks. Java shipping, PostgreSQL, Redis and RabbitMQ stay behind the application services.

```text
Browser → NGINX :8080 (HTTP) / :8443 (optional HTTPS)
           ├── /, /admin, compiled JS/CSS, /images/*.png → frontend:8080
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
| `http/40-cache-policy.conf` | HTML/JS/CSS revalidation, image caching, and no-store for APIs/errors. |
| `servers/http.conf` | Default HTTP listener for local use or a TLS-terminating ingress. |
| `servers/https.conf` | Optional HTTPS listener and HTTP-to-HTTPS redirect. |
| `snippets/routes.conf` | Which URLs serve files, proxy requests or return 404. |
| `snippets/proxy.conf` | Forwarding headers, API timeouts and proxy behavior. |
| `snippets/security-headers.conf` | Browser security headers, including the Razorpay-compatible CSP. |
| `start.sh` | Validates settings, renders templates, checks configuration and starts NGINX. |
| `Dockerfile` | Packages the edge proxy configuration; assets live in the frontend image. |

`http/` files are included inside the main `http` block. One selected server file includes the routes, which include reusable proxy/header settings. `start.sh` substitutes only explicitly listed environment variables, leaving NGINX variables such as `$uri` and `$scheme` intact. Generated configuration lives under `/tmp/robotshop-nginx`; source files remain read-only.

## Minikube

Run `bash build-images.sh` and `bash deploy-minikube.sh` from the repository root. Traefik and cert-manager terminate HTTPS at `https://jithendar.com/roboshop/`; NGINX forwards requests inside the cluster.

```bash
kubectl -n robotshop-ai logs deployment/nginx --tail=100
kubectl -n robotshop-ai exec deployment/nginx -- nginx -t -c /tmp/robotshop-nginx/nginx.conf
```

## Helm

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

## Independent service build

Run `docker build -t robotshop-nginx:local .` from this directory. The Docker context is this folder, not the platform root. Dependencies and runtime libraries are owned here; see [repository split guidance](../../docs/architecture/service-repositories.md).
