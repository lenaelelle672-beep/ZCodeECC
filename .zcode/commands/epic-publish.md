---
description: "Publish a validated epic update back to the issue and local cache."
---

> ZCode compatibility boundary: The ZCode bundle can run GitHub coordination without its optional sql.js local-state cache; persistent coordination snapshots require the npm runtime dependencies.

# /epic-publish

Publish a validated coordination update to GitHub.

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/github-coordination.js" publish <issue-number> --repo <owner/repo>
```

What this does:

1. Re-validates the epic before publishing.
2. Updates the coordination block in the issue body.
3. Appends a concise publish comment.
4. Records the final local snapshot.

Compatibility aliases:

- `/pr`
- `/prp-pr`
