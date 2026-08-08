# ZCodeECC native plugin

Generated from ECC 2.2.0: 67 agents, 284 skills, 94 commands, 122 rules, 21 hooks, and 36 optional MCP definitions.

Do not edit generated files directly. Change the canonical ECC source or `scripts/zcode/`, then run `npm run build:zcode`.

Important: ZCode plugin hooks are runnable immediately when the plugin is enabled. Review `hooks/hooks.json` and `compatibility-manifest.json` before enabling the plugin. Hooks marked `limited` cannot preserve Claude event timing exactly.

MCP servers are not enabled by the plugin. Review the disabled fragments under `mcp/servers/` and opt in one server at a time.
