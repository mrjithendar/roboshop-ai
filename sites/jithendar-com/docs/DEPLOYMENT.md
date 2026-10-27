# Deployment — jithendar.com on mk4

jithendar.com is deployed by **GitHub Actions with `kubectl apply -k`**, not by Argo CD (owner decision, 2026-10-27).

| Piece | Where |
|---|---|
| Image | `881026659929.dkr.ecr.us-east-1.amazonaws.com/jithendar-com` (arm64, immutable tags = commit SHA, scan on push, last 30 kept) |
| Pipeline | `.github/workflows/ci-jithendar-com.yml`: `check` on every push/PR; on `master`, `publish` then `deploy` |
| Manifests | `deploy/base` (Deployment, Service, PDB, NetworkPolicy) + `deploy/production` (Certificate, Traefik middlewares, Ingresses, image pin) |
| CI identity | ServiceAccount `jithendar/jithendar-deployer` (`deploy/ci-access/rbac.yaml`): namespace `jithendar` only, only the kinds in the overlay, **no delete, no Secrets** |
| CI credential | GitHub environment secret `JITHENDAR_KUBECONFIG` (environment `production`), minted by `scripts/ci-kubeconfig.sh` with a 1-year token |
| Image pulls | Secret `jithendar/ecr-pull`, refreshed every 6 h by CronJob `roboshop-ai/ecr-refresh` |
| TLS | Certificate `jithendar/jithendar-com` (apex + www, `letsencrypt-prod`) → Secret `jithendar-com-tls`. That Secret is also the Traefik default certificate (`TLSStore default`) for `/argocd`, `/grafana`, `/prometheus` and `/roboshop`. **Do not delete it.** |

## Routing

- `https://jithendar.com/` → site. Longer path rules (`/argocd`, `/grafana`, `/prometheus`, `/roboshop`) keep priority in Traefik.
- `http://jithendar.com/*` → 308 to https (middleware `jithendar-https-redirect`).
- `http(s)://www.jithendar.com/*` → 308 to `https://jithendar.com/*` in one hop (middleware `jithendar-www-redirect`).

## Release (automatic)

Push or merge to `master` with changes under `sites/jithendar-com/`:

1. **check**: lint, typecheck, tests, build, manifest render.
2. **publish**: builds `linux/arm64` with `GIT_SHA` baked in and pushes `jithendar-com:<commit>` to ECR. It then commits `deploy(jithendar-com): <sha7>`, pinning `image@sha256:…` in `deploy/production/kustomization.yaml`, so Git always records what is live. That commit does not retrigger the workflow.
3. **deploy**:
   1. pins the same digest in its checkout
   2. `kubectl apply -k deploy/production --dry-run=server`, then `kubectl apply -k deploy/production`
   3. `kubectl rollout status`; **on failure it runs `rollout undo`** and the job fails
   4. waits until `https://jithendar.com/api/health` reports the commit
   5. runs `scripts/smoke.sh`

Releases are serialized (`concurrency: jithendar-com-release`), so an older build never overwrites a newer one.

## One-time setup (admin)

```bash
cd sites/jithendar-com
kubectl --context mk4 apply -f deploy/ci-access/rbac.yaml   # create the CI identity
scripts/ci-kubeconfig.sh mk4                                # mint token, verify scope, store the GitHub secret
```

`ci-kubeconfig.sh` refuses to store the credential if it cannot patch Deployments or if it can read Secrets. **Re-run it before the token expires** (it prints the expiry) to rotate.

The self-hosted runner must reach the API server in that kubeconfig (`https://jithendar.com:32811`). If the firewall only allows your own IP, add the runner host.

## Manual deploy

Always deploy what `master` pins. A stale local checkout deploys an old image.

```bash
git pull
kubectl --context mk4 apply -k sites/jithendar-com/deploy/production    # -k with the directory, not -f
kubectl --context mk4 -n jithendar rollout status deployment/jithendar-com
curl -s https://jithendar.com/api/health                                # "version" = commit now live
```

## Smoke test

```bash
sites/jithendar-com/scripts/smoke.sh https://jithendar.com [expected-commit-sha]
kubectl --context mk4 -n jithendar get certificate jithendar-com   # READY True
```

The script checks health (and version), homepage, about, RSS, both sitemaps, robots.txt, 404, the 410 hijack URLs, http→https, www→apex, and that `/argocd/` is unaffected.

## Rollback

- **Immediate:** `kubectl --context mk4 -n jithendar rollout undo deployment/jithendar-com`.
- **Lasting:** revert the source commit and push. CI rebuilds and deploys the older code. Alternatively, pin an older digest from ECR with `scripts/set-image.sh` and run `kubectl apply -k`.

## Limits

Single host: if the server goes down, the site is down. Two replicas cover pod restarts and rollouts only.
