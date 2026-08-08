---
name: configure-ecc
description: "Configure ZCodeECC through ZCode's real plugin UI or the isolated managed-file installer without applying Claude-only scopes or hook profiles."
---

# Configure ZCodeECC

Use only ZCode-native installation surfaces. Inventory first, keep plugin and
managed-file installations separate, preview every filesystem change, and ask
for confirmation before applying it.

## 1. Inventory

Open **Settings -> Plugin Management -> Installed** and identify an enabled
plugin whose ID is `zcode-ecc`. When the bundled CLI is callable, corroborate
the UI with `plugins list --json`; do not treat CLI output as an installer.

Also inspect these paths without changing them:

- `~/.zcode/cli/config.json` for user plugin configuration.
- `./.zcode/config.json` for project plugin configuration.
- `~/.zcode/ecc-install-state.json` for an ECC managed-file install.

If both the native plugin and managed Skills or Commands are present, report
the duplicate-discovery risk and ask which installation the user wants to
keep. Do not remove either route without explicit approval.

## 2. Choose exactly one route

### Native plugin (recommended when Hooks are wanted)

Use **Settings -> Plugin Management** to add or refresh the marketplace
`https://github.com/lenaelelle672-beep/ZCodeECC`, then select `zcode-ecc`.
ZCode Desktop owns installation, update, enable, and disable operations; ZCode
CLI 0.16.1 does not expose an equivalent install command.

Before enabling, review `hooks/hooks.json` and `compatibility-manifest.json`.
The plugin enables no MCP server by default.

### Managed files (recommended when Hooks are not wanted)

From a trusted ZCodeECC checkout, preview the exact request:

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/install-apply.js" --target zcode --profile full --dry-run --json
```

Or use the published package without cloning:

```bash
npx --yes --package ecc-universal ecc install --target zcode --profile full --dry-run --json
```

After the user confirms the displayed target and operations, rerun the same
command without `--dry-run`. Preserve the exact profile, module, or Skill
selection from the preview.

## 3. Verify

For a native plugin, require exactly one enabled `zcode-ecc` entry, then verify
that ZCode can list its Skills and Commands and reports no error diagnostics.
For managed files, require a successful result plus
`~/.zcode/ecc-install-state.json`; verify only the paths recorded there.

Never run `claude plugin`, use `--mode claude-plugin`, offer Claude's
`user | project | local` scopes, or claim Claude Hook profiles apply to ZCode.
