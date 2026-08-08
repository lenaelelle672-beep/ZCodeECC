---
description: "Navigate the installed ZCodeECC plugin, compatibility inventory, Skills, Commands, Hooks, and opt-in MCP fragments."
---

# /ecc-guide

Use the installed ZCodeECC surface as the source of truth. Start with a compact
menu, then inspect only the topic the user selects.

## Canonical installed files

- `${ZCODE_PLUGIN_ROOT}/compatibility-manifest.json` for per-artifact status.
- `${ZCODE_PLUGIN_ROOT}/skills/*/SKILL.md` for discoverable Skills.
- `${ZCODE_PLUGIN_ROOT}/commands/*.md` for slash Commands.
- `${ZCODE_PLUGIN_ROOT}/hooks/hooks.json` for active Hook groups.
- `${ZCODE_PLUGIN_ROOT}/mcp/servers/*.json` for disabled MCP fragments.
- `${ZCODE_PLUGIN_ROOT}/README.md` for installation and trust boundaries.

For a managed-file install, use `~/.zcode/ecc/compatibility-manifest.json` and
the paths recorded in `~/.zcode/ecc-install-state.json` instead.

## Topics

- `setup`: route to the `configure-ecc` Skill.
- `skills` or `commands`: use ZCode's list surfaces and show diagnostics.
- `hooks`: distinguish `adapted` from `limited` records and state that managed
  installation does not activate Hooks.
- `mcp`: show only disabled fragments and require one-server-at-a-time opt-in.
- `find: <query>`: search installed Skills, Commands, and the compatibility
  manifest, grouping exact matches first.

Do not infer support from a generated file alone. Report each result's
`adapted`, `limited`, or `opt-in` status and its compatibility note.
