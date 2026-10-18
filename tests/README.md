# Automated tests

Run `npm test` from the repository root. Node's built-in test runner exercises unit
and end-to-end HTTP behavior. The integration test starts isolated service processes
on ephemeral loopback ports with a temporary store and OTLP receiver, then cleans up.
It also starts an MCP subprocess, probes degraded dependency behavior, and asserts
that traces omit question text. No paid model calls or real orders are made.

The frontend now builds from `services/frontend/src/app.ts`. `npm test` runs its
strict build before the suite. `tests/frontend.test.mjs` exercises the compiled UI
in a DOM environment (safe rendering, startup interaction, stale order recovery and
checkout SDK retry); `tests/runtime.test.mjs` covers fragmented Unicode JSON input.

Validate extracted supporting-service deployments without starting containers:

```sh
docker compose config --format json | node scripts/check-compose.mjs
```

Use configured local credentials; this command does not print the resolved secrets.
The checker verifies actual build/mount paths and the private gateway boundary.
