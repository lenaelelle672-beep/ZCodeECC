---
description: "Sweep blocked epic issues and reopen anything whose dependencies are closed."
---

> ZCode compatibility boundary: The ZCode bundle can run GitHub coordination without its optional sql.js local-state cache; persistent coordination snapshots require the npm runtime dependencies.

# /epic-unblock

Sweep blocked epics whose declared dependencies are complete.

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/github-coordination.js" unblock --repo <owner/repo>
```

What this does:

1. Scans epic issues in the repository.
2. Checks each blocked epic's dependency list.
3. Moves fully unblocked epics to ready.
4. Updates labels, comments, and local snapshots.

Compatibility aliases:

- `/loop-status`
