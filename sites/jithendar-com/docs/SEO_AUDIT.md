# SEO & platform audit — jithendar.com

Phase 1 audit, 2026-10-27. Sources: the `roboshop-ai` working tree (including
uncommitted changes) and read-only HTTPS requests to `https://jithendar.com`.
The cluster was not queried; anything about live cluster state is marked
**unverified**.

## Context

There is no existing Next.js site. jithendar.com was served by a self-hosted
WordPress 7.1.3 (Helm chart `minikube/wordpress`, Argo app `argocd/wordpress.yaml`,
namespace `jithendar`). On 2026-10-27 that install was taken over through its
public setup page and used to publish warez spam. The owner removed it the same
day and does not need its data. At audit close `https://jithendar.com/` returns
**503** and `/argocd/` still returns 200.

### Live-site observations before removal (2026-10-27, UTC)

| Observation | Value |
|---|---|
| WordPress installed | 2026-10-27T00:54:57 (default "Hello world" post and comment) |
| Only user | `tezt` (chart default would be `admin`) |
| Site title | `a` (chart default would be `Jithendar`) |
| Spam posts | 5 posts at 02:17 and 05:20 (`/2026/10/27/<slug>/`); categories `cracks`, `keygen`, `webdl` |
| Sitemaps | `/wp-sitemap.xml` (and `/sitemap.xml` 301 → it) listed the spam |
| Media | 0 items |

## Findings

Severity: Critical / High / Medium / Low. Phase = where the fix lands.

| ID | Area | Finding | Evidence | Severity | Recommended fix | Phase | Status |
|---|---|---|---|---|---|---|---|
| AUD-001 | Security | WordPress was publicly reachable before initialization, so an outsider completed the install and gained admin (code execution in the pod). | `argocd/wordpress.yaml` (deleted, in git HEAD) set `helm.valuesObject.ingress.enabled: true`; `minikube/wordpress/bootstrap.sh` only runs via the imperative installer, never via Argo. Live user `tezt`, title `a`. | Critical | Done: WordPress removed. Still open: check the other workloads the pod could reach (no NetworkPolicy) and rotate any credentials it could see; keep the "never expose before init" rule (AGENTS.md A3.5). | 1 (owner) | Partially resolved |
| AUD-002 | SEO | Spam URLs under `/2026/10/27/…` and `/category/{cracks,keygen,webdl,uncategorized}/` may already be crawled or indexed by search engines. | Feed/sitemap advertised them; `robots.txt` pointed at `wp-sitemap.xml`. | High | New site returns **410 Gone** for those exact paths. Verify the domain in Search Console and request removals. Do not 301 them to new content. | 2 + manual | Open |
| AUD-003 | TLS / shared infra | The shared jithendar.com certificate (`jithendar/jithendar-com` → Secret `jithendar-com-tls`, reused through the Traefik `TLSStore`) was created by the removed WordPress chart. `/argocd`, `/grafana` and others depend on it. | `minikube/wordpress/templates/certificate.yaml`; `minikube/shared-tls/README.md:9-30`; `minikube/shared-tls/configure.py:43-49`. The cert served at audit time was issued 2026-10-27 04:57 UTC and expires 2027-01-25. | High | Move the Certificate into a manifest that is not WordPress (for example a `jithendar-com-tls` Argo app, or the new site's base). Confirm on the cluster whether the Certificate and Secret still exist (**unverified**). If the namespace was deleted, Traefik may be serving a cached cert that will not renew. | 1 (owner) → 6 | Open — needs cluster check |
| AUD-004 | Security | The Kubernetes API is published on `jithendar.com:<port>` from the public internet. The only restriction is a firewall rule for the operator's IP. | `minikube/README.md:27-51,186-205` | High | Keep the API off the public interface, or restrict it strictly to the operator's IP and document it in `docs/SECURITY.md`. No change in this repo without owner approval. | 6 (doc) | Open |
| AUD-005 | Leftover code | The WordPress chart, test and docs remain after the Argo app was removed. | `minikube/wordpress/`, `minikube/test-wordpress.py`, `minikube/shared-tls/configure.py:46,49` (error text tells users to install WordPress) | Medium | Delete the chart and test once AUD-003 is resolved, and update the shared-tls error messages. Needs owner approval (deletion). | 2 | Open |
| AUD-006 | GitOps | AppProject `platform` still allows destination namespace `jithendar`, which is now empty. | `argocd/project-platform.yaml` | Low | Keep it: the new site will deploy there. Recorded as decision D-3. | 6 | Accepted |
| AUD-007 | SEO | No site exists: `/` returns 503, so there is no robots.txt, sitemap, canonical or structured data. | `curl https://jithendar.com/` → 503 | High | Phase 2 (content model, metadata, sitemaps, robots, JSON-LD). Until launch, serving 503 is correct; do not serve a placeholder that can be indexed. | 2 | Open |
| AUD-008 | Content | No genuine content exists to migrate. The only data on the WordPress site was hijack and spam data. | REST API before removal: 6 posts (5 spam + hello-world), 1 page (`sample-page`), 0 media | Info | Descope Phase 7 to "WordPress exit" (410 map, chart cleanup, Search Console). Keep the WXR importer only if an older WordPress.com export with real posts turns up. | 7 | Open — owner to confirm |
| AUD-009 | Host | Documentation and the prompt disagree about the host provider. Docs say Vultr; the prompt says Hetzner. The server is `46.224.38.14`. | `minikube/README.md:51,191,203` | Low | Record the provider-neutral facts (single host, IP, resources) in `docs/ARCHITECTURE.md`. Owner to confirm the provider and actual resources. | 8 | Open |
| AUD-010 | CI/CD | The existing image pipeline pushes `:latest` to ECR. Deployments are not pinned to a digest. | `.github/workflows/publish-ecr.yml` (`tag=latest`) | Medium | The new site's pipeline resolves the digest and pins `image@sha256:` in its overlay. Do not change the RoboShop pipelines. | 6 | Open |
| AUD-011 | CI/CD | Runners are self-hosted ARM64 only. The site image must be built for `linux/arm64`. Whether the nodes are ARM64 is **unverified**. | `publish-ecr.yml` (`runs-on: [self-hosted, linux, ARM64]`, architecture check) | Medium | Confirm node architecture. Build multi-arch or arm64 as appropriate. | 6 | Open |
| AUD-012 | Supply chain | Existing workflows pin actions to tags, not commit SHAs. | e.g. `.github/workflows/showcase-checks.yml:24-28` (`actions/checkout@v7.0.1`) | Low | New site workflows pin to SHAs. Existing workflows are out of scope (RoboShop). | 6 | Open |
| AUD-013 | Network security | The cluster CNI is **kindnet**. Whether Minikube's bundled kindnet enforces NetworkPolicy is **unverified**, and the repo's own docs say it may not. The `jithendar` namespace has no policies. The only policies in the repo are for Kafka and the load lab. | `minikube/README.md:319-326`; `services/kafka-bridge/README.md:86`; `services/kafka-bridge/kafka-internal-network-policy-minikube.yaml` | Medium | Phase 6: default-deny policies for `jithendar`, an enforcement test pod, and Calico/Cilium instructions if the test fails. Changing the CNI affects the whole shared cluster, so the owner decides. | 6 | Open |
| AUD-014 | Secrets | No Sealed Secrets or External Secrets controller exists. Secrets are created imperatively (`create-secrets.sh`, `.secrets/`), and the AppProject blacklists `Secret`. | `argocd/project-platform.yaml` (`namespaceResourceBlacklist: Secret`); `create-secrets.sh` | Medium | Phase 6: choose Sealed Secrets (one controller, works with the Secret blacklist through the SealedSecret CRD) or keep imperative creation with a documented runbook. Owner decision. | 6 | Open |
| AUD-015 | Tooling | Local Node is v20.15.0, but the repo requires Node ≥ 24. | `node -v`; root `package.json` `engines.node: ">=24"` | Medium | Install Node 24+ locally (e.g. via nvm) before Phase 2. Pin it in `.nvmrc` for the site. | 2 | Open |
| AUD-016 | Repo hygiene | The monorepo lives in Google Drive, so `node_modules/` and `.next/` will be synced. | Working-tree path under `GoogleDrive-…/My Drive/Work/` | Low | Exclude build output from Drive sync, or keep a clone outside Drive for builds. The location decision (D-1) stands. | 2 | Open |
| AUD-017 | Automation | n8n is absent. The only Postgres is the RoboShop instance in namespace `roboshop-ai`. | `argocd/postgres.yaml` | Info | Phase 5 deploys its own Postgres in `jithendar` and does not share RoboShop's database. | 5 | Open |
