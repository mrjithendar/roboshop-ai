# web: storefront and reverse proxy

One service, one image (`roboshop-web`), one Kubernetes Deployment and Service (`web`).
It replaces the separate `frontend` (static NGINX) and `nginx` (edge proxy)
workloads. The storefront is a static build (TypeScript plus HTML templates, with no
server rendering), so one NGINX container serves the generated files and proxies
application requests. No Node process runs in the image.

```text
Browser → Traefik (TLS, strips /roboshop) → web :8080
                                              ├── /, /products/<slug>, /cart, /checkout, /account, /login, /register, /admin → generated HTML
                                              ├── *.js, styles.css, images, fonts, illustrations, product media → generated files
                                              ├── /api/*            → ai-gateway :3000 (no retries, no buffering, no caching)
                                              ├── /api/currency/rates → currency-service (optional)
                                              ├── /moks/*, /finder/* → moks :4103 (optional)
                                              ├── /health           → liveness (NGINX only)
                                              └── /ready            → gateway /api/ready (core dependencies only, never LLMs)
```

## Layout

| Path | Contents |
|---|---|
| `frontend/` | Storefront source: `src/*.ts`, HTML pages, `templates/`, `styles.css`, assets, `scripts/build.mjs`, tests. See [frontend/README.md](frontend/README.md). |
| `nginx/` | NGINX templates rendered at start by `start.sh`. See [nginx/README.md](nginx/README.md). |
| `Dockerfile` | Stage 1 (`node:26-alpine`): `npm ci` from `frontend/package-lock.json`, then `npm run build`. Stage 2 (`nginx:1.31-alpine`): the configuration templates and `dist/` only. |
| `web-deployment-minikube.yaml`, `web-service-minikube.yaml` | Kubernetes resources, synced by the `web` Argo CD Application. |

Build context is this directory, as with every other service, so the shared
`publish-ecr.yml` workflow and `scripts/images/build-push-ecr.sh` need no special case.

## Build and run locally

```bash
docker build -t roboshop-web:local services/web
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL -p 8080:8080 \
  -e GATEWAY_HOST=host.docker.internal -e GATEWAY_PORT=3000 roboshop-web:local
docker run --rm --entrypoint /bin/sh roboshop-web:local /etc/nginx/roboshop/start.sh --test   # nginx -t only

# Without Docker (NGINX >= 1.28 and envsubst on PATH):
npm run frontend:build
npm run test:nginx                     # starts this service against a mock gateway
```

During native development (`npm run dev`), the gateway still serves
`frontend/dist` directly, so no NGINX is needed.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FRONTEND_BASE_PATH` | empty | Public mount segment. Set to `/roboshop` behind the ingress; root-relative HTML `href`/`src` attributes are rewritten. Requests arrive without the prefix because Traefik's `roboshop-prefix` middleware strips it. |
| `GATEWAY_HOST`, `GATEWAY_PORT` | `ai-gateway`, `3000` | Gateway upstream, re-resolved every 10 s. |
| `NGINX_HTTP_PORT` | `8080` | Unprivileged listener. |
| `NGINX_TLS`, `NGINX_HTTPS_PORT`, `NGINX_SERVER_NAME`, `NGINX_TLS_*_FILE` | off | Optional in-container TLS for use without an ingress. In Minikube, Traefik and the shared certificate terminate TLS. |
| `WEB_ROOT` | `/usr/share/nginx/html` | Generated files; `start.sh` refuses to start if `index.html` is missing. |
| `NGINX_RUN_DIR` | `/tmp/roboshop-nginx` | Rendered configuration, pid and temporary paths (the root filesystem is read-only). |

There is no public runtime configuration and no build argument. The browser reads store
settings from `/api/settings`, so no backend secret can reach the image or the page.

## Behaviour kept from the two old services

- **Routes and status codes:** every public URL and method limit is unchanged.
  - There is no SPA fallback: unknown paths, source files, `product.html` and `/admin/`
    return 404.
  - A missing `/api/...` route returns the gateway's own 404 JSON, never a page.
- **Headers:** the same security headers and CSP (Razorpay and Turnstile), set at server
  scope.
- **Request limits:** 64 KiB bodies, or 2 MiB for `/api/admin/product-images`, with the
  same client and upstream timeouts.
- **Gateway proxying:** no retries (`proxy_next_upstream off`) and no buffering, so
  checkout and webhooks are never replayed and responses stream. Client forwarding headers
  are replaced. Cookies reach only the gateway and Moks.
- **Tracing and logs:** `traceparent` and `tracestate` are forwarded, and `X-Request-ID`
  is added. JSON access logs contain no query strings, cookies or bodies, and successful
  health and readiness checks are not logged.
- **Caching:**
  - HTML revalidates or is `no-store`.
  - JS and CSS revalidate (`max-age=0, must-revalidate`), because file names are not
    fingerprinted.
  - Images are cached for a day, fonts for a week.
  - Content-addressed product images are `immutable`.
  - API responses and errors are `no-store`.
- **Changed:** access-log `service` is now `web`, and page requests are logged under route
  groups (`home`, `product_detail`, `checkout`, `authentication`, `profile`, `admin`,
  `assistant`) instead of `static`. `/health` reports `"service":"web"`. One internal
  proxy hop is gone.

## Migrating a running cluster

Every Application is `Prune=false,Delete=false`, and nothing auto-syncs, so Git changes
take effect only when synced. Removing `frontend.yaml` and `nginx.yaml` from the catalog
**does not delete** the live Applications or workloads.

1. **Build and push** the new image, `roboshop-web:latest`. Run Terraform first if the
   `roboshop-web` ECR repository does not exist yet.
2. **Start web without moving traffic:**

   ```bash
   ./deploy-argocd.sh web
   kubectl -n roboshop-ai rollout status deployment/web
   kubectl -n roboshop-ai port-forward svc/web 18080:8080 &
   curl -fsS localhost:18080/ready && curl -fsS localhost:18080/ | grep -q 'Find your kind of robot'
   curl -fsS -o /dev/null -w '%{http_code}\n' localhost:18080/api/missing   # expect 404 JSON
   ```

   Traffic still flows through the old `nginx`.
3. **Switch the ingress**, only after step 2 succeeds:

   ```bash
   ./deploy-argocd.sh roboshop-config
   curl -fsSI https://jithendar.com/roboshop/ && curl -fsS https://jithendar.com/roboshop/api/ready
   ```

   Do **not** use `./deploy-argocd.sh roboshop` for this step. That shortcut syncs
   `roboshop-config` first.
4. **Retire the old workloads** after a soak period. Remove only the Applications'
   tracking, then delete the resources explicitly:

   ```bash
   kubectl -n argocd delete application frontend nginx --cascade=orphan
   kubectl -n roboshop-ai delete deployment,service frontend nginx
   ```

5. Keep the `roboshop-frontend` and `roboshop-nginx` ECR repositories until rollback is no
   longer needed; Terraform still lists them.

### Rollback

- **Before step 4:** point both ingresses back at the old Service, and the old pods carry
  traffic again immediately:

  ```bash
  for name in roboshop roboshop-http; do
    kubectl -n roboshop-ai patch ingress "$name" --type=json \
      -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"nginx"}]'
  done
  ```

  Then revert the ingress change in Git, so a later `roboshop-config` sync does not
  undo the rollback.
- **After step 4:** restore the old manifests and Argo Applications from Git history
  (`git show <commit>^:argocd/nginx.yaml`, and so on), then sync `frontend` and `nginx`
  before switching the ingress back.
