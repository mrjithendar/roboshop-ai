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
Direct-provider saves validate fields and commit only if the revision is current,
without calling a model. This allows repairs during an outage (`verifiedAt` is
cleared). Enabling automatic failover is different: Save tests both exact proposed
providers before committing the policy and `verifiedAt`. Both must succeed; there
is no fallback during these tests. Test connection also tests both for an enabled
policy, without activating it. A failed test
never modifies the active record; stale saves are rejected atomically.
On a revision conflict, refresh and review the other operator's configuration.

Configuration and sanitized change audit entries (actor ID, time, revision,
provider/model, fallback policy and action) are committed in one atomic MongoDB document update,
using primary reads and majority writes. The most recent 1,000 changes are retained;
the admin API returns the most recent 20. Archive separately if longer retention
is required. Endpoint URLs, access keys and prompts are not audit fields.

Before each generation attempt the agent reads the active revision/configuration
from the authenticated gateway endpoint. A changed revision, disconnect, or failed
read rejects the attempt, including a queued Bedrock fallback. An attempt already
authorized/started can finish; disconnect cannot revoke a remote generation. The
configuration read is the authorization boundary, not a distributed cancellation
transaction. **Disconnect does not stop or delete
an Ollama EC2 instance, unload its model, or remove any AWS resources.** Operator
infrastructure shutdown remains a separate action.

## Operator setup

Minikube initializes `LLM_SERVICE_TOKEN` in `roboshop-secrets` and shares it only with the gateway and shopping agent. Keep existing credentials when upgrading. Configure the approved Ollama endpoint mapping in the moks manifest, then rebuild and deploy with `bash build-images.sh` and `bash deploy-minikube.sh`.

For native development, `python3 generate-secrets.py` creates a new private `.env`; an existing installation should add only missing keys rather than regenerate database credentials. Configure `LLM_SERVICE_TOKEN` and `OLLAMA_ENDPOINTS_JSON` before starting the services.

Log in as super admin and open the AI / LLM configuration panel. Provider changes do not require restarting services. Token rotation or an operator allowlist change requires restarting the affected backends.

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
  serviceSecretName: roboshop-llm
  ollamaEndpoints:
    private-ec2: http://10.0.1.25:11434
  workloadIdentityEnabled: false # true when using Bedrock EKS identity
  serviceAccountAnnotations: {}
  langfuseSecretName: ""
  networkPolicyEnabled: true
```

For example, with a private file containing just the token:
`kubectl -n roboshop-ai create secret generic roboshop-llm --from-file=LLM_SERVICE_TOKEN=/secure/path/llm-token`.
The file must contain the token without a trailing newline. Never pass token
values inline in shell history. The chart reads only explicitly named keys;
it does not import an arbitrary secret wholesale into the agent. Configure
`llm.langfuseSecretName` separately if needed. The NetworkPolicy permits gateway,
SRE health checking, and same-namespace Prometheus pods with
`app.kubernetes.io/name=prometheus`; adapt monitoring selectors to your deployment.
It restricts ingress, not egress; network egress policy remains operator-owned.

## Optional automatic failover

Default remains `{"provider":"none"}`. Ollama-only and Bedrock-only documents are
unchanged. Superadmins may explicitly enable this policy (endpoint aliases remain
operator allowlisted):

```json
{
  "provider": "ollama", "endpoint": "private-ec2", "model": "qwen3:8b",
  "automaticFailover": true,
  "fallback": {"provider": "bedrock", "region": "us-east-1", "model": "YOUR_MODEL_ID"}
}
```

Unchecking the setting saves an Ollama-only configuration. Workload IAM credentials
remain the only Bedrock authentication mechanism; the UI never accepts AWS keys.
Activation tests and Bedrock inference incur usage charges depending on the model
and tokens. Failover sends the question and retrieved catalogue context to AWS in
the configured region (inference profiles may route across regions). Check your
model/profile's processing locations and account pricing before opting in. A timeout
can leave primary processing in progress: both attempts can incur processing costs.
See [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) and
[cross-region processing](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html).

## Limits, failures and observability

Responses are buffered, never streamed. A successful answer is returned once; no
provider switch happens after content delivery. There is at most one primary and
one Bedrock attempt, with SDK retries disabled. Only primary connection failures,
timeouts, and HTTP 429/500/502/503/504 permit fallback. Invalid input, HTTP auth
errors, TLS certificate verification errors, policy refusals, malformed responses,
and local capacity exhaustion do not. Unknown failures fail closed. Both providers
failing returns a sanitized unavailable response, not catalogue text as an answer.

The per-replica, in-memory breaker opens after three eligible primary failures.
For 30 seconds requests use Bedrock directly (still checking the active revision).
Then exactly one request may try Ollama; concurrent requests continue to Bedrock.
Success closes the breaker; another eligible failure reopens it. Configuration
revision changes reset it. Restart resets it; replicas do not share breaker state.

Background checks run at most every 30 seconds after the first configured chat,
with cached results at authenticated `GET /internal/llm/readiness`. They never
generate answers: Ollama checks `/api/tags`, Bedrock checks TLS connectivity only.
Bedrock connectivity does not prove model/IAM access; activation tests do. Results
are diagnostics, not permission to switch providers (an auth/model error must not
be disguised as transport failure). Provider readiness is not pod readiness.
The worker refreshes active configuration before checking; disconnect stops further
scheduled provider checks once observed. An already-started check can finish.

The agent has a 16-second monotonic budget starting before retrieval. Retrieval is
capped at 2 seconds, authoritative revision reads at 1 second each, and failover
attempts at 6 seconds each or the remaining budget, whichever is smaller. Direct
mode allows up to 12 seconds within the same total budget. Bounded executor slots
remain occupied until timed-out work actually finishes, preventing unbounded queues.
Two provider workers and four retrieval/config workers exist per replica. The
gateway admits at most two simultaneous agent chat calls without queuing, leaving
HTTP workers available for the agent's revision callbacks (avoiding chat saturation
starving its own configuration checks).
Gateway catalogue retrieval is capped at 2 seconds and its agent request at 18;
Finder waits 26 seconds, the widget 29, and its NGINX route 30. Admin tests allow
19 seconds server-side and 25 in the browser. Socket timeouts alone are not total
deadlines, so the agent also bounds blocking reads and inference with futures.
Adapters cap output at 600 tokens (32 for tests); Ollama caps response at 64 KiB.
Timeouts cannot guarantee cancellation of remote computation; there is no same-
provider retry, and a disconnected/new configuration prevents subsequent attempts.

OpenTelemetry/Langfuse generation spans for both attempts share the routing/request
trace. Metadata includes actual provider, configured model, revision, purpose,
fallback reason, outcome, latency, and token counts when available. No prompts,
answers, credentials or endpoint URLs are emitted. Telemetry failure never changes
provider selection.

## Verification

Mongo-backed tests require a dedicated `MONGODB_URL`; otherwise those tests skip.
All provider tests use mocks, including SDK mappings and errors, so they perform
no paid calls. Real AWS IAM/model access, Ollama model compatibility/performance,
EKS identity injection, NetworkPolicy enforcement and live telemetry ingestion
must be verified in your deployment. No cloud/model-server resources are provisioned.

References: [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html),
[Ollama chat](https://docs.ollama.com/api/chat),
[Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).
