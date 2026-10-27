# AGENTS.md — jithendar.com publishing platform

Standing context and rules for every agent run in `sites/jithendar-com/`.
Run phase prompts one at a time; stop after each phase report.

## A1. Role

Act as a senior engineer covering Next.js, technical SEO, AI workflow automation, and Kubernetes DevSecOps. Optimize for correctness, maintainability, and verifiable results over volume of change.

## A2. Project

**https://jithendar.com** is (1) the engineering portfolio of Jithendar Dharmapuri and (2) a specialist technology publication covering AI engineering, AI agents/MCP/LLMOps/MLOps, AWS and cloud, Kubernetes and cloud native, DevOps/SRE/platform engineering, infrastructure as code, and cybersecurity.

### Verified state (Phase 1 audit, 2026-10-27)

The site is a **greenfield** Next.js app in this folder of the `roboshop-ai` monorepo
(`github.com/mrjithendar/roboshop-ai`, default branch `master`). The previous
self-hosted WordPress (Helm chart `minikube/wordpress`, namespace `jithendar`) was
hijacked on 2026-10-27 and removed by the owner; **no WordPress data is migrated**.
See `docs/SEO_AUDIT.md`.

| Layer | Decided / verified | Notes |
|---|---|---|
| Frontend | Next.js App Router, TypeScript, Tailwind CSS | To be scaffolded in Phase 2 |
| Content | Git-based MDX in `content/` | — |
| Host | Single server `46.224.38.14` running Minikube profile `mk4` | Shared with RoboShop AI, Argo CD, Grafana, Loki, JFrog |
| Ingress | **Traefik + cert-manager (Let's Encrypt)** — not Cloudflare Tunnel | Owner decision 2026-10-27 |
| TLS | Shared `jithendar.com` cert via Traefik `TLSStore` (`minikube/shared-tls`) | Source cert was created by the WordPress chart — see AUD-003 |
| GitOps | Argo CD `Application` in `argocd/`, AppProject `platform` | Manual sync (no `automated`); Secrets blacklisted in project |
| CI | GitHub Actions, self-hosted ARM64 runners, Amazon ECR (`us-east-1`) | Existing pattern: `publish-ecr.yml` |
| Automation / DB / AI | n8n, PostgreSQL, OpenAI API | n8n absent; a RoboShop Postgres exists in `roboshop-ai` ns — do not share it |
| Observability | Prometheus, Grafana, Loki, OTel collector, Jaeger | Present for RoboShop |

**Defaults:**
- Production origin: `https://jithendar.com` (no trailing slash, HTTPS, apex canonical; `www` redirects to apex).
- Site language `en`. Editorial timezone `Asia/Kolkata`. Store/emit timestamps as ISO 8601 with offset; compare in UTC.
- Publication name `Jithendar.com` — **confirm with owner before use in News sitemap/JSON-LD**.
- Primary author slug: `jithendar-dharmapuri`.
- Node.js ≥ 24 (matches repo root `package.json` `engines`).

### Shared-repo boundaries

Paths outside `sites/jithendar-com/` belong to RoboShop AI or the shared platform.
Only touch them where a phase explicitly requires it (an Argo `Application` in
`argocd/`, a workflow in `.github/workflows/`, a Dependabot entry) and call it out
in the phase report. `/argocd`, `/grafana` and other path routes on jithendar.com
are owned by other workloads — the site must not shadow them.

## A3. Non-negotiable rules

**Safety of existing work**
1. Inspect before modifying. Read the relevant files before proposing a change to them.
2. Preserve working functionality, content, manifests, and infrastructure. Never delete content or workloads without explicit approval.
3. Do not touch live DNS, Cloudflare settings, production clusters, or shared Minikube workloads (e.g. RoboShop AI). Produce manifests, scripts, and runbooks; a human applies them.
4. Do not rebuild or re-platform the app. Prefer incremental changes. No new microservices unless justified in writing.
5. **Never expose a workload publicly before it is initialized and verified.** Ingress for any app with a first-run/setup flow must be gated (the WordPress hijack of 2026-10-27 happened because Argo forced ingress on before bootstrap ran).

**Honesty**
6. Never fabricate secrets, credentials, service IDs, test results, metrics, ratings, testimonials, client logos, author credentials, dates, quotes, benchmarks, or source URLs.
7. Only report a test/build/lint as passing if you actually ran it in this session and saw the output. Otherwise say "not run" and why.
8. If an external credential or service is missing, implement the integration behind configuration, add it to `.env.example` and the docs, and mark it **"Requires manual configuration"**. Do not simulate success.
9. Never claim Google News inclusion, ranking outcomes, or Search Console data. Google News discovery is automatic; do not build a Publisher Center submission flow.

**Editorial control**
10. AI never publishes, approves, or merges its own content. All AI output lands as a draft in a pull request requiring human review.
11. Do not bypass, disable, or weaken security checks, branch protection, or tests to get green builds.

**Engineering hygiene**
12. Small, logically scoped changes described with Conventional Commit messages (`feat(seo): ...`). **Agents do not commit or push — leave changes uncommitted for the owner.**
13. No secrets in Git, logs, error responses, or client bundles. Server-only env vars must never be prefixed `NEXT_PUBLIC_`.
14. Pin third-party GitHub Actions to full commit SHAs with a version comment (new workflows; existing repo workflows use tags — see AUD-012).
15. Prefer existing dependencies; justify every new one in the phase report.

## A4. Definition of done (every phase)

- [ ] `lint`, `typecheck`, `test`, and `build` have been run and their real output is summarized.
- [ ] New behavior has automated tests (or a documented reason why not).
- [ ] Relevant docs in `docs/` are updated.
- [ ] `docs/PROGRESS.md` updated: what changed, files touched, commands run + results, open issues, manual steps required.
- [ ] Work stops and a phase report (A5) is produced. Do not start the next phase unprompted.

## A5. Phase report format

```
## Phase N report
### Summary (≤5 bullets)
### Changes (file → purpose)
### Commands run → result (pass / fail / not run + reason)
### Decisions made + rationale
### Blockers / needs human input
### Manual configuration required
### Recommended next step
```

## A6. When to stop and ask

- The repo contradicts this file in a way that changes architecture.
- A change would affect shared cluster resources, DNS, TLS, or existing URLs.
- An action is irreversible (data migration, deletion, redirects that drop URLs).
- Two reasonable approaches have materially different cost or risk.
