# Shopping agent

Port 4103, internal POST `/api/chat` with `{"message":"security under 1000"}`.
Retrieves up to four in-stock keyword/synonym matches and recognizes numeric budgets.
Optional OPENAI_API_KEY + OPENAI_MODEL enable Responses API synthesis. Without both,
or on provider errors, the response explicitly reports `mode: catalogue-search`.
No conversation memory, external tools, or commerce mutations. Query text is not logged.
The gateway supplies sold-out SKUs from its demo ledger. External traffic must go
through the gateway's input limits and rate limiter.
