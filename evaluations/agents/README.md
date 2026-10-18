# Agent behavior checks

`tests/catalogue.test.mjs` verifies no-model operation, grounded model request shape,
response extraction and provider-failure fallback. `tests/integration.test.mjs` checks
chat over HTTP and MCP tool allowlisting. The optional model is mocked, never contacted
by tests. There are no autonomous checkout or infrastructure actions to evaluate.
