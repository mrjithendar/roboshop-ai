# Automated tests

Run `npm test` from the repository root. Node's built-in test runner exercises unit
and end-to-end HTTP behavior. The integration test starts isolated service processes
on ephemeral loopback ports with a temporary store and OTLP receiver, then cleans up.
It also starts an MCP subprocess, probes degraded dependency behavior, and asserts
that traces omit question text. No paid model calls or real orders are made.
