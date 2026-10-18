# Optional Langfuse tracing

Configure LANGFUSE_BASE_URL for your project region or self-hosted instance,
LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in `.env`. Only shopping-agent spans are
sent to `/api/public/otel/v1/traces`, with Basic authentication and ingestion version 4.
AI mode, model name and token usage are included; prompts and generated text are not.
The local collector can receive the same agent spans independently. No Langfuse server
is deployed by this repository, and live Langfuse delivery has not been verified here.

Reference: https://langfuse.com/integrations/native/opentelemetry
