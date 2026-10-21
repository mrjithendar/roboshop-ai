# Security evaluations

`cases.json` exercises malicious-looking prompts in catalogue-only mode. `npm run
evaluate` checks that results remain catalogue-bound. HTTP integration tests additionally
cover invalid payloads, cross-origin mutation rejection, session isolation, authoritative
pricing and disabled MCP mutation tools. These do not prove live-model prompt injection
resistance; model-mode red teaming remains a separate evaluation activity.
