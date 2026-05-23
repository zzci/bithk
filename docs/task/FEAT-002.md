# FEAT-002 — Unified share module

- **Status:** Done
- **Plan:** [PLAN-002](../plan/PLAN-002.md)
- **Created:** 2026-05-23
- **Owner:** main

## Scope

Extract all token-based sharing (document public links + drive direct/public
shares) into a single `share` module backed by one polymorphic `shares` table
with a per-resource adapter registry. Redesign, no backward compatibility.

Document **collaborator** shares (viewer/editor policy tuples) stay in the
policy engine and are out of scope.

## Verification

- `bun run check` clean (lint + typecheck).
- Ported share service / public-access tests pass under the new module.
- Manual: create/list/update/revoke a share for both a document and a drive
  file/folder; anonymous token access (meta, password, download, folder
  browse) works for both resource types from one public landing page.
