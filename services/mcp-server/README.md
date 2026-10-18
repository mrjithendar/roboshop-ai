# Read-only MCP adapter

Start the platform first, then configure a local MCP client to run:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/robotshop-ai/services/mcp-server/server.mjs"]
}
```

The stdio transport uses newline-delimited JSON-RPC and protocol version 2025-11-25.
It supports initialize, ping, tools/list and tools/call. Tools: `search_products`
(`query` string) and `service_health` (empty object). No order, payment or shell tools.
RECOMMENDATION_URL and SRE_URL select internal services when using other ports.
Do not run with npm as a client's protocol command: npm's banner is not JSON-RPC.
Search uses imported catalogue availability, not the gateway's demo order ledger.
