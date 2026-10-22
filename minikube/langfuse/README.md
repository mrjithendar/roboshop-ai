# Langfuse at https://jithendar.com/langfuse/

Langfuse collects AI traces: request timing, model/provider attempts, errors and available token usage. RoboShop exports metadata from shopping-agent asynchronously; a dashboard failure does not block shopping. Project API keys authenticate ingestion, not dashboard login. Create your dashboard account and project after installation, then connect the project keys.

## Build and deploy

The stock image cannot serve this subpath. The [official subpath guide](https://langfuse.com/self-hosting/deployment/infrastructure/subpath) requires `NEXT_PUBLIC_BASE_PATH` at image build time. This configuration builds upstream v4.63.0 with `/langfuse`; stripping the ingress prefix is not a substitute.

1. Publish `.github/workflows/ci-langfuse.yml` to your repository, then run **Langfuse subpath image** in GitHub Actions. It builds amd64 and arm64 web images and pushes `881026659929.dkr.ecr.us-east-1.amazonaws.com/roboshop-langfuse:4.63.0-subpath`. The self-hosted runner needs Docker/Buildx and AWS ECR create/describe/push access. Worker uses the upstream image.
2. With Helm >=4.3.1, kubectl, Python 3 with PyYAML, and AWS CLI configured, run from the repository root:

   ```bash
   bash minikube/deploy-langfuse.sh
   kubectl --context=mk4 -n langfuse get pods,pvc,ingress
   ```

3. Open **https://jithendar.com/langfuse/**, create an account and project, then connect its API keys:

   ```bash
   bash minikube/connect-langfuse.sh
   ```

The deploy script checks the image exists before changing cluster resources. It uses the existing shared certificate via Traefik's default TLSStore; it does not request another certificate. DNS and host ports 80/443 must already reach Traefik. It submits resources without waiting for startup. Existing data and credentials are retained.

The Helm postrenderer prepends ownership repair to PostgreSQL and Valkey initialization for Minikube volumes. It changes file ownership, not database contents. A temporary Helm plugin directory is cleaned on exit. Run future upgrades through this script so these changes remain applied.

## Troubleshooting

```bash
kubectl --context=mk4 -n langfuse get pods,pvc,ingress
kubectl --context=mk4 -n langfuse logs deployment/langfuse-web --tail=80
kubectl --context=mk4 -n langfuse get events --sort-by=.lastTimestamp
```

- **404 or broken assets:** verify the custom image is deployed and ingress preserves `/langfuse`. Auth URL and probes must include the prefix.
- **Permission denied / database unreachable:** inspect `prepare-data-permissions` init-container logs on PostgreSQL/Redis pods. Redeploy with this script; do not delete PVCs or regenerate database secrets.
- **Bad CPU type in executable:** the installer tests AWS CLI candidates and skips incompatible executables (for example, an old Intel CLI on Apple Silicon). You can explicitly select one with `AWS_CLI=/opt/homebrew/bin/aws bash minikube/deploy-langfuse.sh`. Both ECR calls use this same executable.
- **ImagePullBackOff:** the ECR pull token expires after 12 hours. Rerun deployment to refresh it before rescheduling, or include namespace `langfuse` in your credential-rotation automation. This installer does not install a recurring token refresher.
- **No traces:** rerun the connection helper with project keys; internal ingestion URL is `http://langfuse-web.langfuse.svc.cluster.local:3000/langfuse`. Trigger a shopping-agent request. Keep keys out of logs and screenshots.
- **Pending/OOM:** inspect node capacity; this stack adds ClickHouse, PostgreSQL, Valkey and object storage. It requires substantially more resources than just the web container.

## Manifest regression checks

Render with Helm 4 and the local `postrenderer` plugin (as the deployment script does), then run:

```bash
python3 minikube/langfuse/tests/test_render.py /tmp/langfuse-rendered.yaml
```

A rendered-manifest check cannot prove a built Next.js image works. After publishing and deploying, verify the dashboard, sign-in, static assets and an ingested trace in the browser.
