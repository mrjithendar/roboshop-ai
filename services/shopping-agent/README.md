# Python shopping agent

`server.py` serves `POST /api/chat`, `/health` and `/metrics` on port 4103 using
Waitress. `agent.py` retrieves at most four in-stock products, applies budgets,
excludes unavailable SKUs supplied by the gateway, and optionally synthesizes a
response through the existing OpenAI Responses integration. Without configured
`OPENAI_API_KEY` and `OPENAI_MODEL`, or when the provider fails, the response clearly
identifies catalogue-search mode. The agent cannot call mutation tools or pay.

Install `requirements.txt` in a virtual environment and run `python server.py`.
Set `INGESTION_URL` for the catalogue. Existing OTLP trace propagation, metrics and
optional Langfuse export are supported; prompts, keys and cookie values are not
included in telemetry. Model calls use `store: false` and a 15-second timeout.

The dedicated Dockerfile builds from the repository root. Compose/Helm continue
using the same service name, port and JSON contract.

HTTP serving limits follow the [Waitress configuration API](https://docs.pylonsproject.org/projects/waitress/en/v3.0.2/arguments.html).
