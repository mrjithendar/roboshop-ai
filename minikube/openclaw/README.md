# OpenClaw GitOps resources

See [architecture, deployment and runbooks](../../docs/openclaw/README.md).

- `base`: protected storage, gateway, existing-service operations adapter, telemetry
  packages, restricted egress, namespace Roles and network policies.
- `overlays/mk4`: observed StorageClass/API endpoint; private staging by default.
- `overlays/public`: opt-in existing Traefik/shared TLS routing, blocked example IP.
- `argocd`: isolated project/Application; no automatic prune or deletion finalizer.
- `monitoring`: dashboard and opt-in values for the existing releases.

Render with `kubectl kustomize minikube/openclaw/overlays/mk4`. Do not apply until
image references, Secrets and a tested network-policy engine are ready.
