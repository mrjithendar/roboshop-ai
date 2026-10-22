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
