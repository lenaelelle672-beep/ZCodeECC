---
description: Update ZCodeECC through the installation route that actually owns it, with a preview for managed files.
disable-noninteractive: true
---

# Auto Update ZCodeECC

First determine whether ZCodeECC is owned by ZCode Plugin Management or by
`~/.zcode/ecc-install-state.json`. Do not update both routes and do not run
`git pull` inside ZCode's plugin cache.

## Native plugin

Open **Settings -> Plugin Management -> Installed**, select `zcode-ecc`, and
use ZCode's refresh or reinstall control. Verify that the resulting plugin ID
is `zcode-ecc`, then list Skills and Commands and check diagnostics. ZCode CLI
0.16.1 can inspect installed plugins but does not provide an equivalent update
command.

## Managed files

When operating from a trusted ZCodeECC git checkout, preview first:

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/auto-update.js" --target zcode --dry-run --json
```

Require the preview to identify that checkout as the repository root and show
only the recorded ZCode install request. After explicit confirmation, rerun it
without `--dry-run`.

If no trusted checkout exists, reconstruct the profile, modules, or Skill IDs
from `~/.zcode/ecc-install-state.json` and preview a current package install:

```bash
npx --yes --package ecc-universal ecc install --target zcode <recorded-selection> --dry-run --json
```

Never synthesize `<recorded-selection>` or mutate files when the recorded
request cannot be verified.
