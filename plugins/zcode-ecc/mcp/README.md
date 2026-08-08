# Optional MCP fragments

ZCode auto-connects every configured MCP server. ZCodeECC therefore declares no MCP server in the primary plugin manifest.

Each file in `servers/` uses the strict `mcp.servers` schema and starts with `enabled: false`. Copy only the server you need into a ZCode configuration, replace placeholders out of band, review its command/network/data boundary, then enable it explicitly.
