# Deployment — jithendar.com on mk4

**CI builds and pushes the image; `sites/deploy.sh` deploys it** with `kubectl apply -k` (owner decision, 2026-10-27). Argo CD is not used for this site, and CI has no cluster access.

| Piece | Where |
|---|---|
| Image | `881026659929.dkr.ecr.us-east-1.amazonaws.com/jithendar-com` (arm64, immutable tags = commit SHA, scan on push, last 30 kept) |
| Pipeline | `.github/workflows/ci-jithendar-com.yml`: `check` on every push/PR; on `master`, `publish` pushes `jithendar-com:<commit-sha>` |
| Deploy | `sites/deploy.sh [commit-sha]`, run by a person with the `mk4` kubeconfig and AWS access |
| Manifests | `deploy/base` (Deployment, Service, PDB, NetworkPolicy) + `deploy/production` (Certificate, Traefik middlewares incl. compression, Ingresses, image pin) |
| Image pulls | Secret `jithendar/ecr-pull`, refreshed every 6 h by CronJob `roboshop-ai/ecr-refresh` |
| TLS | Certificate `jithendar/jithendar-com` (apex + www, `letsencrypt-prod`) → Secret `jithendar-com-tls`. That Secret is also the Traefik default certificate (`TLSStore default`) for `/argocd`, `/grafana`, `/prometheus` and `/roboshop`. **Do not delete it.** |

## Routing

- `https://jithendar.com/` → site. Longer path rules (`/argocd`, `/grafana`, `/prometheus`, `/roboshop`) keep priority in Traefik.
- `http://jithendar.com/*` → 308 to https (middleware `jithendar-https-redirect`).
- `http(s)://www.jithendar.com/*` → 308 to `https://jithendar.com/*` in one hop (middleware `jithendar-www-redirect`).
- Text responses are compressed by Traefik (zstd/br/gzip; middleware `jithendar-compress`).

## Release

1. Push to `master`. CI runs `check`, then `publish` builds `linux/arm64` with `GIT_SHA` baked in and pushes `jithendar-com:<commit-sha>`. The run summary prints the exact deploy command.
2. When the run is green, from the `roboshop-ai` root:
   ```bash
   git pull
   sites/deploy.sh            # the image built for your current HEAD
   sites/deploy.sh <sha>      # a specific commit (also how you roll back)
   ```
   `deploy.sh` resolves the digest in ECR, pins it in `deploy/production/kustomization.yaml`, server dry-runs, applies, waits for the rollout (runs `rollout undo` if it fails) and runs the smoke test.
3. Commit the updated `kustomization.yaml` so Git records what is live.

Always deploy from an up-to-date checkout: `deploy.sh` applies the manifests in your working tree.

## Smoke test

```bash
sites/jithendar-com/scripts/smoke.sh https://jithendar.com [expected-commit-sha]
kubectl --context mk4 -n jithendar get certificate jithendar-com   # READY True
```

The script checks health (and version), homepage, about, RSS, both sitemaps, robots.txt, 404, the 410 hijack URLs, http→https, www→apex, and that `/argocd/` is unaffected.

## Rollback

- **Immediate:** `kubectl --context mk4 -n jithendar rollout undo deployment/jithendar-com`.
- **Lasting:** `sites/deploy.sh <older-commit-sha>` (any commit among the last 30 images in ECR).

## Limits

Single host: if the server goes down, the site is down. Two replicas cover pod restarts and rollouts only.
