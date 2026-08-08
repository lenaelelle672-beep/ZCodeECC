---
description: "Mark epic review requested, approved, or changes requested."
---

> ZCode compatibility boundary: The ZCode bundle can run GitHub coordination without its optional sql.js local-state cache; persistent coordination snapshots require the npm runtime dependencies.

# /epic-review

Coordinate review state for an epic issue.

```bash
node "${ZCODE_PLUGIN_ROOT:-$HOME/.zcode}/scripts/github-coordination.js" review <issue-number> --repo <owner/repo> --review approved
```

What this does:

1. Updates the review state in the coordination block.
2. Syncs review labels to GitHub.
3. Records the review outcome in an audit comment.
4. Keeps the local cache aligned with the issue body.

Compatibility aliases:

- `/review-pr`
- `/code-review`
