# Langfuse for RoboShop

Langfuse is the AI tracing dashboard; it does not run Ollama/Bedrock or replace
Prometheus. A request has one trace ID with child observations for catalogue
retrieval, grounded generation and each provider attempt. Support can inspect the
actual provider/model, duration, errors, fallback reason and available token usage.
Cost estimates depend on Langfuse recognizing model pricing and receiving usage;
they are not an AWS billing report. Automated evaluations and prompt management
are Langfuse features but are not enabled by this integration.

## Install on Minikube

Requires Helm 4.3.1+, kubectl, Python 3, working PVC provisioning and context `mk4`
(or set KUBE_CONTEXT). This installs a private dashboard, not a public ingress:

```bash
bash minikube/deploy-langfuse.sh
kubectl --context=mk4 -n langfuse get pods,pvc
kubectl --context=mk4 -n langfuse port-forward svc/langfuse-web 3000:3000
```

Open http://localhost:3000 on the machine running port-forward. With the remote
Minikube kubeconfig, run port-forward on your Mac. Create an account and project,
then create project API keys under project settings. Keep the browser port-forward
running while using the dashboard. No DNS or public firewall change is required.

Apply the updated agent manifest through your normal deployment, then connect:

```bash
kubectl --context=mk4 apply -f services/shopping-agent/shopping-agent-minikube.yaml
bash minikube/connect-langfuse.sh
```

The connection script asks privately for both keys and merges just three fields
into the existing `roboshop-ai/roboshop-secrets`: LANGFUSE_BASE_URL,
LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY. It restarts shopping-agent. No key is
printed or passed as a command-line argument. The agent uses the internal service
URL, so tracing continues after the dashboard port-forward closes.

## What runs

Pinned chart 2.1.6 installs web, worker, PostgreSQL, Valkey (Redis-compatible queue)
and SeaweedFS object storage. A standalone ClickHouse 26.4 StatefulSet stores
observations without cluster-wide operators. The namespace is `langfuse`; app
credentials remain in `roboshop-ai`. Langfuse infrastructure has separate secrets
because Kubernetes cannot reference a Secret across namespaces.

This is a single-instance development installation, not HA. Requests total roughly
4 GiB memory plus overhead; limits allow higher peaks. It shares the host with
Minikube workloads and runner builds. PVC requests total about 40 GiB including
queue storage. Inspect actual rendered storage/resources before sizing your host.
Back up all PVC data and Secrets together. Rerunning preserves credentials; missing
ClickHouse credentials with existing storage causes a refusal, not a reset.
Do not delete Secrets to reset passwords or uninstall persistent data casually.

## Trace flow and privacy

Finder → authenticated gateway → shopping-agent LangGraph workflow → Ollama or
Bedrock. The agent sends OTLP JSON asynchronously to
`/api/public/otel/v1/traces` with project Basic authentication and ingestion version
4. Only shopping-agent spans go to Langfuse. The same trace ID lets operators
correlate with gateway logs and the separate general OTel backend; gateway spans
are not duplicated into Langfuse. LangChain automatic LangSmith export stays off.

Metadata only: no prompt, answer, customer email, password or provider credentials
are exported. Existing bounded asynchronous exports use a two-second timeout and
drop on saturation/failure, so Langfuse is not a readiness dependency. This is
best-effort observability, not a durable audit log. OTEL_SDK_DISABLED=true or an
unsampled trace disables exports. Project cost estimates may be incomplete.

After connecting, ask Finder a question while logged in with an LLM configured.
Look for retrieval/generation observations and the actual model in Langfuse.
Failover produces separate attempts under the same trace. If nothing appears,
check agent env references (do not print key values), OTEL_SDK_DISABLED, project
keys, then web/worker logs and PVC status. No AI request means no generation trace.
Model-disconnected responses deliberately do not call a provider.

To disable exporting, remove only the three LANGFUSE keys from roboshop-secrets
and restart shopping-agent; do not delete the shared Secret. Public HTTPS ingress
is not included; add it with an explicit hostname and certificate before exposing
the dashboard publicly.

References: [Helm deployment](https://langfuse.com/self-hosting/deployment/kubernetes-helm),
[OTel/API authentication](https://api.reference.langfuse.com/).
