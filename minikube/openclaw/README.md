# OpenClaw GitOps resources

See [architecture, deployment and runbooks](../../docs/openclaw/README.md).

- `base`: protected storage, gateway, existing-service operations adapter, telemetry
  packages, restricted egress, namespace Roles and network policies.
- `overlays/mk4`: StorageClass, API endpoint, state-node placement and authenticated
  Traefik ingress for `/openclaw`, managed together in one overlay.
- `argocd`: isolated project/Application; no automatic prune or deletion finalizer.
- `monitoring`: dashboard and opt-in values for the existing releases.

Render with `kubectl kustomize minikube/openclaw/overlays/mk4`. Do not apply until
image references, Secrets and a tested network-policy engine are ready.
