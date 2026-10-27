# YAML resource layout

Active Kubernetes source files contain one resource per file; no `---` separators.
Names use `<resource-name>-<kind>.yaml`, with `-minikube` before `.yaml` for service
manifests. PVC is abbreviated `pvc`. Namespaced RBAC files sharing a resource name
also include the namespace, e.g. `traefik-alloy-logs-role-binding.yaml`.

Examples:

- `services/frontend/frontend-deployment-minikube.yaml`
- `services/frontend/frontend-service-minikube.yaml`
- `minikube/roboshop/roboshop-config-configmap.yaml`
- `observability/prometheus/templates/prometheus-data-pvc.yaml`

Argo Applications explicitly include their resource filenames, or use an existing
Kustomization. Kustomizations are single objects that list files; they do not embed
resources. Helm templates each emit at most one resource. Rendered Helm/Kustomize
output still uses YAML document separators as required by those tools; source
configuration does not. Historical upstream files under `legacy/` are not rewritten.

Apply grouped ingress resources with `kubectl apply -k minikube/argocd` or
`kubectl apply -k minikube/vault`, rather than applying a removed bundle filename.
The load-test manifests are under `tests/load/kubernetes/`.

Run `python3 -m pytest -q tests/test_yaml_layout.py` to check the convention and
local references. Deployment metadata, object names, ports, selectors and storage
settings are unchanged by this reorganization. Publish the new paths together
with their updated Argo Applications. `./deploy-argocd.sh <app>` aligns the live
Application's source and destination with Git before syncing; until then a
renamed file leaves the live Application rendering nothing. Never sync such an
Application with prune: `./deploy-argocd.sh status` lists them.
