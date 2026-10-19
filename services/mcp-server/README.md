# Python MCP server

Run `npm run mcp`, or configure an MCP client with the Python interpreter and
absolute path to `services/mcp-server/server.py`. The process uses stdio JSON-RPC;
stdout contains protocol responses only. No third-party packages are required.

Set `GATEWAY_URL` to the gateway's reachable internal URL. Public tools search and
compare products, list shipping countries/cities, and inspect service health.
Availability comes from the gateway, including reserved/sold quantities.

Account tools read/update the cart and return cart-based recommendations. Admin
tools list/create/update products; super-admin tools list users, change user access,
and read/update public store settings. All 15 tools have strict input schemas.
Mutation tools are marked destructive and should be invoked only after the user
requests the specific change. Tools cannot execute shell commands or take payments.

For protected tools, configure `MCP_SESSION_TOKEN` through the client's secret
injection facility with the value of an existing `rs_auth` session. Never commit
it, paste it into prompts, or put it in command-line arguments. Set `PUBLIC_ORIGIN`
to the store's exact origin for authenticated mutations. The gateway validates the
session and role on every request: customers cannot use admin tools, admins cannot
change roles/settings, and the super-admin account remains protected. Sessions
expire after eight hours and are revoked on logout or access changes. No elevated
service identity or arbitrary cookie/header override is provided.
