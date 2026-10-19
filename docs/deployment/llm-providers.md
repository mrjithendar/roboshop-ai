# LLM provider configuration

A fresh installation uses `provider=none`. Legacy OpenAI environment variables
are ignored. Chat returns **Please connect an LLM to get AI recommendations.**
without invoking a provider or presenting catalogue matches as generated text.
Normal browsing, search, recommendations, cart, checkout and MCP tools remain
available. OpenAI is no longer an adapter.

## Ownership and activation

The gateway authenticates superadmins, checks Origin/CSRF protections, validates
configuration and stores it in MongoDB's separate `llm_configuration` collection.
Public settings and MCP settings tools cannot read or write this collection.
The shopping agent owns all inference; it has no MongoDB credentials.

Admin → **AI / LLM configuration** provides current configuration and revision,
provider fields, **Test connection**, **Save and activate**, **Disconnect**, and
**Refresh**. A test uses the proposed fields without changing the active record.
Save independently repeats the bounded test and commits only if the revision is
still current. A failed test or concurrent update leaves the active record intact.
On a revision conflict, refresh and review the other operator's configuration.

Configuration and sanitized change audit entries (actor ID, time, revision,
provider/model and action) are committed in one atomic MongoDB document update,
using primary reads and majority writes. The most recent 1,000 changes are retained;
the admin API returns the most recent 20. Archive separately if longer retention
is required. Endpoint URLs, access keys and prompts are not audit fields.

For every customer request the gateway reads the active record and sends a
validated snapshot and revision to `/internal/chat` with a service bearer token.
The agent validates again against its operator allowlist. It accepts no customer
provider settings, and direct `/api/chat` on the agent is rejected. The gateway
accepts exactly `{ "message": "..." }` for public chat. Agent ports are not
published by Compose. Helm supplies an ingress NetworkPolicy (enforcement requires
a supporting CNI); do not expose the agent through an ingress/load balancer.
Within Compose the shared private network still requires service authentication;
use network segmentation/mTLS if deploying across untrusted networks.

Provider switches/disconnect affect requests whose configuration snapshot is read
after the MongoDB commit. Requests already in flight may complete on the previous
provider; disconnect does not cancel them. **Disconnect does not stop or delete
an Ollama EC2 instance, unload its model, or remove any AWS resources.** Operator
infrastructure shutdown remains a separate action.

## Common operator setup (Compose)

1. Install this code and build/pull new **ai-gateway**, **shopping-agent** and
   **frontend** images. Nginx routing is unchanged.
2. For a fresh installation, `python3 generate-secrets.py` now generates
   `LLM_SERVICE_TOKEN` alongside the existing database/payment secrets.
   For an existing `.env`, add only the missing LLM token; do not regenerate
   database passwords. This command fills a missing/blank token without printing it:

   ```bash
   python3 - <<'PY'
   import os, re, secrets
   from pathlib import Path
   p = Path('.env')
   content = p.read_text()
   match = re.search(r'^LLM_SERVICE_TOKEN=(.*)$', content, re.M)
   if match and match.group(1).strip().strip('"\''):
       raise SystemExit('LLM_SERVICE_TOKEN already set; preserving it.')
   line = 'LLM_SERVICE_TOKEN=' + secrets.token_hex(32)
   content = re.sub(r'^LLM_SERVICE_TOKEN=.*$', line, content, flags=re.M) if match else content.rstrip() + '\n' + line + '\n'
   p.chmod(0o600)
   p.write_text(content)
   print('LLM service token configured; value not printed.')
   PY
   ```

3. Set `OLLAMA_ENDPOINTS_JSON={}` initially, or the approved mapping described below.
4. Recreate the two backends once to load the operator token/allowlist, plus the
   frontend to load the new UI:

   ```bash
   docker compose config --quiet
   docker compose up -d ai-gateway shopping-agent frontend
   ```

5. Log in with the existing superadmin account and open `/admin`. Subsequent
   **provider/model changes and disconnect require no restart**. Changing the
   operator allowlist or rotating the service token does require updating both
   backend deployments. A missing token leaves ordinary commerce and unconfigured
   chat operational, but activation fails closed.

Use `./build-images.sh` to build local images, or the individual ECR workflows.
Do not bake secrets into Docker images. The containers remain non-root, read-only,
and capability-restricted. For native `npm run dev`, the launcher supplies a
shared ephemeral LLM token if none is configured; both children receive the same
value. Install both Python service requirements first.

## Bedrock setup

1. Choose a Bedrock **Converse-compatible** text model or inference profile in a
   supported AWS region. Complete any provider model-access prerequisites in your
   AWS account. The application does not request access or provision resources.
2. Attach a least-privilege policy to the **shopping agent's workload role**.
   For example, for direct Nova Micro inference in us-east-1:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock:InvokeModel",
       "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0"
     }]
   }
   ```

   Substitute the selected model resource. Inference profiles require permission
   on the profile ARN and the underlying foundation-model ARNs in the profile's
   destination regions; account SCPs must allow those regions. No model-list,
   IAM administration, EC2 creation or streaming permission is required by this
   non-streaming implementation. Model availability is account/region dependent.
3. **EC2 Compose:** attach the role through the EC2 instance profile. Make IMDSv2
   reachable by the agent container (bridge networking commonly requires metadata
   response hop limit 2). Restrict metadata access from other containers using
   host networking policy; an instance role otherwise applies at instance scope.
   Do not put `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` into the admin UI.
   Standard Lightsail does not provide an EC2 instance-profile attachment workflow;
   for this workload-identity setup run the agent on EC2/EKS instead of adding
   long-lived AWS keys to a Lightsail deployment.
4. **EKS:** use the dedicated `<release>-shopping-agent` service account created
   by the chart. Configure EKS Pod Identity (including its agent) or IRSA externally
   with the role above. Set `llm.workloadIdentityEnabled: true`. For IRSA, set
   `llm.serviceAccountAnnotations.eks.amazonaws.com/role-arn` to the role ARN and
   configure the IAM OIDC trust for that namespace/service account. Pod Identity
   associations are created externally, not by this chart.
5. Allow outbound HTTPS to Bedrock runtime in the selected region (and STS or
   workload credential endpoints as required), via NAT or appropriate VPC endpoints.
6. In Admin choose **Amazon Bedrock**, enter region (for example `us-east-1`) and
   the exact model/profile ID (for example `amazon.nova-micro-v1:0`). Click
   **Test connection**, then **Save and activate**. These actions each make a
   small, potentially billable inference call. They were NOT run during development.

The adapter uses boto3's default credential chain, fixed AWS service endpoints,
Converse messages and bounded `maxTokens`; it collects no credentials in MongoDB.
Access-denied, invalid-model, throttling and timeout responses are sanitized.

## Ollama setup

1. Provision/run Ollama separately, download your chosen model there, and confirm
   that its `/api/chat` API works. This application does not create an instance,
   download models, start Ollama or expose its port publicly.
2. Give that server a stable private IPv4 address reachable from the shopping agent.
   Permit TCP 11434 only from the agent's actual source security group/address.
   Bind Ollama to its private interface; do not open it to the internet. No customer
   cookie, authorization token or service bearer token is forwarded to Ollama.
3. Add an operator mapping to `.env`, for example:

   ```dotenv
   OLLAMA_ENDPOINTS_JSON='{"private-ec2":"http://10.0.1.25:11434"}'
   ```

   The same mapping is supplied to gateway and agent. Only aliases appear in the
   admin dropdown; raw endpoint URLs are never stored in the provider document or
   exposed through public settings. The mapping accepts `http`/`https`, literal
   IPv4 hosts and explicit ports only. RFC1918 addresses are permitted only by
   exact operator approval; loopback, link-local/metadata, multicast, unspecified,
   reserved and other non-global/non-RFC1918 addresses are rejected. DNS names,
   IPv6, userinfo, paths, queries, fragments and redirects are rejected. HTTPS
   certificates must be trusted and valid for the literal IP address. DNS support
   requires a future pinned-resolution design; do not weaken the validation.
4. Recreate gateway and agent to load the allowlist. For EKS, set the equivalent
   `llm.ollamaEndpoints` map in Helm values.
5. In Admin choose **Ollama**, select `private-ec2`, enter the exact installed model
   name/tag (for example `qwen3:4b`), test and save. Models must fit the Ollama host's
   memory. Cold loading may exceed the bounded test deadline; warm the model on
   its host before testing rather than increasing application concurrency.

The adapter connects directly to the approved IP/port, ignoring HTTP proxy
environment variables and never following redirects. It sends `stream=false`,
`num_ctx=4096`, `num_predict=600` (32 for tests), and `keep_alive=5m`. Boolean
thinking is disabled for the qwen3 model family; other models
use their own defaults and no thinking text is returned to customers. Confirm
compatibility with your installed model/version during the explicit test.

## Helm settings

Create an existing Secret containing `LLM_SERVICE_TOKEN` in the release namespace
(using your normal secret management workflow), then configure:

```yaml
llm:
  serviceSecretName: robotshop-llm
  ollamaEndpoints:
    private-ec2: http://10.0.1.25:11434
  workloadIdentityEnabled: false # true when using Bedrock EKS identity
  serviceAccountAnnotations: {}
  langfuseSecretName: ""
  networkPolicyEnabled: true
```

For example, with a private file containing just the token:
`kubectl -n robotshop-ai create secret generic robotshop-llm --from-file=LLM_SERVICE_TOKEN=/secure/path/llm-token`.
The file must contain the token without a trailing newline. Never pass token
values inline in shell history. The chart reads only explicitly named keys;
it does not import an arbitrary secret wholesale into the agent. Configure
`llm.langfuseSecretName` separately if needed. The NetworkPolicy permits gateway,
SRE health checking, and same-namespace Prometheus pods with
`app.kubernetes.io/name=prometheus`; adapt monitoring selectors to your deployment.
It restricts ingress, not egress; network egress policy remains operator-owned.

## Limits, failures and observability

Provider results normalize `answer`, `provider`, `model`, `input_tokens` and
`output_tokens` (null if unknown). Public chat distinguishes `not-configured`,
`provider-unavailable`, and `success`/`mode=ai`. No cross-provider fallback and no
catalogue-text fallback occur. A dependency/network failure returns sanitized HTTP
errors with request IDs; provider failures return an explicit unavailable result.

Each agent process accepts two simultaneous provider calls with no unbounded
queue. Caller deadline is 12 seconds. Bedrock uses 3s connect/8s read timeouts and
one total SDK attempt. Ollama uses 8s socket timeout plus a 10s connection shutdown
timer and a 64 KiB response limit. A timed-out provider operation may still be
finishing server-side; it cannot later activate configuration, and its agent slot
is retained until the worker finishes. Test requests use a fixed short prompt;
chat sends only the current message and at most four bounded product excerpts.

OTLP and optional Langfuse retain existing trace propagation. Generation spans
record provider, configured model, revision, purpose (`test` versus `chat`),
latency, outcome and available token counts. They do not record raw questions,
answers, endpoints, actor IDs or credentials. Model/revision attributes are span
metadata, not metric labels. Disabling telemetry does not change provider selection.

## Verification

```bash
.venv/bin/python -m pip install -r services/ai-gateway/requirements.txt -r services/shopping-agent/requirements.txt -r tests/python/requirements.txt
.venv/bin/python -m unittest discover -s tests/python -v
.venv/bin/python scripts/evaluate.py
npm run frontend:typecheck
npm run frontend:build
node --test tests/admin-ui.test.mjs tests/frontend.test.mjs
docker compose config --quiet
```

Mongo-backed tests require a dedicated `MONGODB_URL`; otherwise those tests skip.
All provider tests use mocks, including SDK mappings and errors, so they perform
no paid calls. Real AWS IAM/model access, Ollama model compatibility/performance,
EKS identity injection, NetworkPolicy enforcement and live telemetry ingestion
must be verified in your deployment. No cloud/model-server resources are provisioned.

References: [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html),
[Ollama chat](https://docs.ollama.com/api/chat),
[Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).
