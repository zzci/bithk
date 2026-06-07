# PLAN-071 - Flatten lode artifact layout

- Status: Completed
- Task: [REFACTOR-028](../task/REFACTOR-028.md)
- Campaign: local
- Created: 2026-06-07

## Problem

The current lode asset preserves apps/api/dist, apps/web/dist, and
apps/api/drizzle inside the archive. That structure is not required by lode; it
only exists because runtime code still looks up the web build and Drizzle
migrations through source-tree paths.

CodeQL also remains as a non-blocking but visibly failing CI job because this
private repository cannot upload code scanning results without GitHub Advanced
Security.

## Proposal

1. Remove the CodeQL job from the CI workflow.
2. Change the package script to stage a flattened runtime directory:
   - index.js for the API bundle entry;
   - dist/ for the built web app;
   - drizzle/ for migrations;
   - package.json for concise runtime scripts.
3. Update runtime lookup helpers so packaged releases prefer dist/ and drizzle/
   at ROOT_DIR, while source-tree runs fall back to apps/web/dist and
   apps/api/drizzle.
4. Update release workflow validation to expect the new manifest entry.

## Verification

- bun run package
- tar -tzf dist/bit-linux-x64.tar.gz
- bun run check

## Annotations

- 2026-06-07: Implemented. The release archive now contains index.js, dist/, drizzle/, and package.json at the root; manifest and lode template entry are index.js. Verification passed: bun run package, tar path checks, bun dist/package/index.js migrate --check, bun run check.
