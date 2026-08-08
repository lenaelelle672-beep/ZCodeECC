---
description: "Sync epic issue bodies, labels, and local coordination snapshots from GitHub."
---

> ZCode compatibility boundary: The ZCode bundle can run GitHub coordination without its optional sql.js local-state cache; persistent coordination snapshots require the npm runtime dependencies.

# /epic-sync

Run a deterministic sync for epic issues.

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/github-coordination.js" sync --repo <owner/repo>
```

What this does:

1. Reads issue bodies as the canonical epic state.
2. Reconciles the coordination block with labels.
3. Writes a fresh local snapshot for each epic issue.
4. Keeps the SQLite cache aligned with GitHub.

Compatibility aliases:

- `/projects`
- `/work-items sync-github`
