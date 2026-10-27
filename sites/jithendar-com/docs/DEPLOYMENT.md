# Deployment — jithendar.com on mk4

| Piece | Where |
|---|---|
| Image | `881026659929.dkr.ecr.us-east-1.amazonaws.com/jithendar-com` (arm64, immutable tags = commit SHA, scan on push, last 30 kept) |
| Build & deploy | `.github/workflows/ci-jithendar-com.yml`: `check` on every push/PR; on `master`, `publish` (image + digest commit) then `deploy` (wait for rollout + smoke test) |
| Manifests | `deploy/base` (Deployment, Service, PDB, NetworkPolicy) + `deploy/production` (Certificate, Traefik middlewares, Ingresses, image pin) |
| GitOps | `argocd/jithendar-com.yaml` (AppProject `platform`, namespace `jithendar`). **Auto-sync, no prune, no self-heal**: the only app with auto-sync (allow-listed in `scripts/argocd/validate.py`) |
| Image pulls | Secret `jithendar/ecr-pull`, refreshed every 6 h by CronJob `roboshop-ai/ecr-refresh` |
| TLS | Certificate `jithendar/jithendar-com` (apex + www, `letsencrypt-prod`) → Secret `jithendar-com-tls`. That Secret is also the Traefik default certificate (`TLSStore default`) for `/argocd`, `/grafana`, `/prometheus` and `/roboshop`. **Do not delete it.** |

## Routing

- `https://jithendar.com/` → site. Longer path rules (`/argocd`, `/grafana`, `/prometheus`, `/roboshop`) keep priority in Traefik.
- `http://jithendar.com/*` → 308 to https (middleware `jithendar-https-redirect`).
- `http(s)://www.jithendar.com/*` → 308 to `https://jithendar.com/*` in one hop (middleware `jithendar-www-redirect`).

## Release (automatic)

Push or merge to `master` with changes under `sites/jithendar-com/`:

1. **check**: lint, typecheck, tests, build, manifest render.
2. **publish**: builds `linux/arm64` with `GIT_SHA` baked in, pushes `jithendar-com:<commit>` to ECR, and commits `deploy(jithendar-com): <sha7>` that pins `image@sha256:…` in `deploy/production/kustomization.yaml` (via `scripts/set-image.sh`). This commit does not retrigger the workflow.
3. **Argo CD** notices the commit within about 2 minutes and syncs (rolling update, no downtime with 2 replicas).
4. **deploy**: polls `https://jithendar.com/api/health` until `version` equals the commit (10-minute limit), then runs `scripts/smoke.sh`. A red `deploy` job means the release did not go live or is unhealthy.

Releases are serialized (`concurrency: jithendar-com-release`), so an older build never overwrites a newer digest.

### One-time bootstrap

The Argo Application has to exist in the cluster once, after the files are on GitHub:

```bash
kubectl --context mk4 apply -f argocd/jithendar-com.yaml
```

If the first `deploy` job timed out before that, re-run it from the Actions tab.

## Smoke test

```bash
sites/jithendar-com/scripts/smoke.sh https://jithendar.com [expected-commit-sha]
kubectl --context mk4 -n jithendar get certificate jithendar-com   # READY True
```

The script checks: health (and version), homepage, both sitemaps, robots.txt, 404, the 410 hijack URLs, http→https, www→apex, and that `/argocd/` is unaffected.

## Rollback

Revert the `deploy(jithendar-com): …` commit you want to undo and push. Argo CD auto-syncs the previous digest. (Reverting a source commit instead triggers a fresh build of the older code.) For an emergency, run `kubectl --context mk4 -n jithendar rollout undo deployment/jithendar-com`; Argo shows OutOfSync until Git matches.

## Limits

Single host: if the server goes down, the site is down. Two replicas cover pod restarts and rollouts only.
