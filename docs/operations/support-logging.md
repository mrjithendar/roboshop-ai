# Diagnosing application failures

Python and Node HTTP runtimes log structured JSON with service, event, traceId,
method, safe operation/route, HTTP status and duration. Expected Python rejections
now include a stable errorCode, an allowlisted reason and function:line source.
Unknown exception text is intentionally omitted: database/HTTP exception strings
can contain credentials, query data or customer information. Go uses structured
slog, Java uses named log fields, and Finder/Kafka/demo retain service-local logs.
Infrastructure images (MongoDB, PostgreSQL, Redis, RabbitMQ, Kafka, OTel and Jaeger)
keep their native logging; this change does not enable database statement logging.

Login failures now reach the browser as approved messages, not a generic gateway
failure. The account UI displays the trace ID as a support reference. Challenge
widget status is separate so resetting a challenge cannot overwrite the login error.

| Code/event | Meaning | Support action |
| --- | --- | --- |
| AUTH_INVALID_CREDENTIALS | Email/password rejected, or account unavailable | Ask customer to use password recovery; never request their password |
| authentication_challenge_passed | Human verification succeeded | Do not troubleshoot Cloudflare for a subsequent credential rejection |
| CHALLENGE_REQUIRED / CHALLENGE_INVALID / CHALLENGE_REUSED | Missing, expired, invalid or already consumed token | Complete a fresh challenge; do not replay the login request |
| CHALLENGE_MISCONFIGURED | Turnstile configuration missing or rejected | Check deployment key references and dashboard hostname without printing secrets |
| CHALLENGE_UNAVAILABLE | Verification dependency unavailable | Check network and provider status; retry with a fresh token |
| AUTH_RATE_LIMITED | Authentication attempt limit reached | Wait the advertised cooldown |
| DEPENDENCY_UNAVAILABLE | An upstream service failed | Correlate traceId with upstream logs and check readiness |
| HTTP_4xx / HTTP_5xx | Other validation or service failure | Use operation, source and correlated trace; no arbitrary error text is exposed |
| dependency_retry_scheduled | One safe read retry scheduled | Check dependency, attempt count and latency |
| KAFKA_DELIVERY_UNCONFIRMED | Kafka delivery not acknowledged | RabbitMQ retains the event; check broker connectivity and queue backlog |

```bash
# Replace the example reference with the customer's support reference.
kubectl -n roboshop-ai logs deployment/ai-gateway --since=15m | grep 'TRACE_ID'
kubectl -n roboshop-ai logs deployment/user-service --since=15m | grep 'TRACE_ID'
kubectl -n roboshop-ai logs kafka-0 -c kafka-bridge --tail=100
```

HTTP helper retries are bounded to two total attempts for transient GET/HEAD
transport failures and HTTP 502/503/504, with jittered 100–199 ms backoff within
the original request budget. No retries for authentication/validation rejection,
health probes, writes, payment creation, verification callbacks, email sends or
LLM generation. Upstream passthrough calls are not retried. Existing LLM failover,
payment reconciliation, RabbitMQ shipping retries and Kafka redelivery remain
owned by their existing state machines. Never enable a blanket ingress retry on
POST requests: timeouts can represent a successful payment with a lost response.

Normal level is INFO; use LOG_LEVEL=DEBUG only for additional probe details in
services that support it. No request bodies, passwords, authorization headers,
Turnstile tokens, SMTP/API keys or raw exception strings are added to logs.

## Business events and user identity

`user_logged_in` is emitted only after successful authentication (including MFA)
and session issuance. `user_login_mfa_required` records a pending second factor,
not a successful login. `user_login_failed` includes a bounded normalized login
email in `username`, outcome, safe reason/errorCode and trace ID. It deliberately
does not distinguish a nonexistent account from a wrong password or disabled account.
`user_registered` and `user_logged_out` cover registration and session revocation.
MFA failures may lack a username because a submitted challenge is not a trusted identity.

Identity fields appear only in user-service authentication events. They are personal
data: restrict log access to authorized support and apply the organization's log
retention policy. Passwords, tokens, raw request payloads, addresses and card data
are never included. Do not paste identity-bearing log exports into public tickets.

Cart logs include `cart_updated`, revision conflicts and payment-driven clearing.
Node services include named payment creation/verification/reconciliation/webhook,
catalogue and recommendation operation events. HTTP success means that operation
completed, not necessarily that a payment was captured; authoritative capture
remains `checkout_payment_captured` in the gateway with the order ID. Ingestion
logs catalogue seed completion. Other endpoints retain route, outcome, duration,
errorCode and trace correlation; infrastructure retains its native service logs.

The standalone FastAPI demo was retired. FastAPI remains the AI gateway framework.
Its ECR repository is removed from Terraform defaults; no AWS resources or images
are deleted by these code changes. Review the next Terraform plan before applying.

## Readable console format

Minikube's shared ConfigMap sets `LOG_FORMAT=text`. Python/Node services, Finder,
Kafka bridge and the Go currency service support it. Java shipping already uses
readable Spring/SLF4J lines; infrastructure keeps its native logs.

Example (illustrative):

```text
2026-10-22T04:40:00Z INFO  [user-service] User logged in successfully | event=user_logged_in username="alice@example.com" outcome="success" traceId="..."
2026-10-22T04:40:01Z WARN  [user-service] User failed to log in | event=user_login_failed username="alice@example.com" errorCode="AUTH_INVALID_CREDENTIALS" reason="Invalid email or password."
```

JSON remains the default outside Minikube and now includes a human-readable
`message`. Use `LOG_FORMAT=json` for collectors requiring JSON parsing. Values
are escaped onto one line; logging sink failures must not affect requests.
HTTP 5xx uses ERROR; expected 4xx/retries use WARN; successful work uses INFO.

After building the updated images, change only the logging key in an existing
cluster (preserving its other configuration), then deploy:

```bash
kubectl -n roboshop-ai patch configmap roboshop-config --type=merge -p '{"data":{"LOG_FORMAT":"text"}}'
bash deploy-minikube.sh
```

New installs receive this setting from `minikube/roboshop/config.yaml`.
