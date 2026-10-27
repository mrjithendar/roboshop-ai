# Deployment — jithendar.com on mk4

| Piece | Where |
|---|---|
| Image | `881026659929.dkr.ecr.us-east-1.amazonaws.com/jithendar-com` (arm64, immutable tags = commit SHA, scan on push, last 30 kept) |
| Build | `.github/workflows/ci-jithendar-com.yml`: `check` on every push/PR; `publish` on the default branch (self-hosted ARM64 runner) |
| Manifests | `deploy/base` (Deployment, Service, PDB, NetworkPolicy) + `deploy/production` (Certificate, Traefik middlewares, Ingresses, image pin) |
| GitOps | `argocd/jithendar-com.yaml` (AppProject `platform`, namespace `jithendar`, manual sync like the other apps) |
| Image pulls | Secret `jithendar/ecr-pull`, refreshed every 6 h by CronJob `roboshop-ai/ecr-refresh` |
| TLS | Certificate `jithendar/jithendar-com` (apex + www, `letsencrypt-prod`) → Secret `jithendar-com-tls`. That Secret is also the Traefik default certificate (`TLSStore default`) for `/argocd`, `/grafana`, `/prometheus` and `/roboshop`. **Do not delete it.** |

## Routing

- `https://jithendar.com/` → site. Longer path rules (`/argocd`, `/grafana`, `/prometheus`, `/roboshop`) keep priority in Traefik.
- `http://jithendar.com/*` → 308 to https (middleware `jithendar-https-redirect`).
- `http(s)://www.jithendar.com/*` → 308 to `https://jithendar.com/*` in one hop (middleware `jithendar-www-redirect`).

## Release

1. Merge to `master`. The `publish` job prints the image digest in the run summary.
2. Pin it:
   ```bash
   cd sites/jithendar-com/deploy/production
   kustomize edit set image jithendar-com=881026659929.dkr.ecr.us-east-1.amazonaws.com/jithendar-com@sha256:<digest>
   ```
   Commit and push, then sync `jithendar-com` in Argo CD.
3. Smoke test (below).

**First deploy only:** applied directly with `kubectl apply -k deploy/production` before the Argo app existed. Argo CD adopts the same resources on its first sync.

## Smoke test

```bash
curl -sI https://jithendar.com/ | head -1                      # 200
curl -s  https://jithendar.com/api/health                      # {"status":"ok"}
curl -sI http://jithendar.com/ | grep -i location              # https://jithendar.com/
curl -sI https://www.jithendar.com/blog | grep -i location     # https://jithendar.com/blog
curl -s  https://jithendar.com/robots.txt                      # lists both sitemaps
curl -s -o /dev/null -w '%{http_code}\n' https://jithendar.com/category/cracks/   # 410
curl -s -o /dev/null -w '%{http_code}\n' https://jithendar.com/argocd/            # 200 (unaffected)
kubectl --context mk4 -n jithendar get certificate jithendar-com                    # READY True
```

## Rollback

Point `deploy/production/kustomization.yaml` back at the previous digest (Git revert), push, and sync. For an emergency, run `kubectl --context mk4 -n jithendar rollout undo deployment/jithendar-com`; Argo shows OutOfSync until Git matches.

## Limits

Single host: if the server goes down, the site is down. Two replicas cover pod restarts and rollouts only.
