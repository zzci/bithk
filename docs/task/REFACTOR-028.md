# REFACTOR-028 - Flatten lode release artifact layout

- Status: Completed
- Plan: [PLAN-071](../plan/PLAN-071.md)
- Campaign: local
- Owner: local
- Created: 2026-06-07

## Summary

Flatten the lode release archive so it does not preserve the source monorepo
layout. The release asset should look like a small runtime app directory with a
root entry, built web assets under dist, and migrations under drizzle.

Acceptance criteria:

- CI no longer runs the CodeQL job that fails on private repository code scanning permissions.
- The lode archive contains a root runtime entry, dist/, drizzle/, and package.json.
- Runtime static asset and migration lookup works from the flattened archive and from the source tree.
- Release workflow validation matches the new archive entry.
- bun run package and bun run check pass.

## Status notes

- 2026-06-07: Completed. Removed the private-repo CodeQL CI job, flattened the lode asset around root index.js, dist/, and drizzle/, and kept source-tree fallbacks for local static assets and migrations. Verification: bun run package, tar structure check, packaged migrate --check, bun run check.
