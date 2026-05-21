# PLAN-001 — Drive frontend parity pass

- **Status:** Done
- **Created:** 2026-05-21
- **Owner:** drive campaign

## Problem

The drive backend (entries, versions, shares, team directories) and the
individual web components (`FileBrowser`, share dialog/lists, team-directory
list/members, file preview, file picker) were built and merged separately.
Nothing assembled them into a usable page, the new components referenced
i18n keys that `drive.json` did not yet define, and the owner-aware
folder/text-file create endpoints were not reachable from the UI.

## Goals

1. Assemble a single drive page with three tabs — **My files**, **Team
   directories**, **Shared with me** — wiring the merged components together
   with page-level share + preview dialogs.
2. Bring `apps/web/src/locales/{en,zh}/drive.json` to full parity with every
   `t()` key the assembled components reference (en/zh key sets identical,
   `check:i18n` green).
3. Thread `{ ownerType, ownerId }` through `useCreateDriveFolder` /
   `useCreateTextFile` and the `FileBrowser` create calls so creating inside
   a team directory produces team-owned entries (editor+ gated server-side).
4. Close the live e2e gap: owner-scoped entry listing by membership and
   folder/text-file create gating by role.

## Approach

- Replace `drive.lazy.tsx` with a `Tabs`-based page (shadcn/ui + base-ui).
  My files mounts `FileBrowser` over the caller's id; Team directories opens
  each directory's `FileBrowser` (role from `useTeamDirectory`) plus a
  member panel for admins; Shared with me surfaces received / sent / link
  lists in a nested tab set.
- Extend the two create hooks with optional owner fields (omitted keys fall
  back to the personal drive) and forward `FileBrowser`'s owner into them.
- Rewrite both `drive.json` shards from the components' key usage, removing
  the superseded single-page baseline keys.
- Add a `team-directories.test.ts` case for the listing/create role matrix.

## Verification

`bun run check` (lint, typecheck, test, build, check:i18n, check:env-docs,
check:api-docs) plus `bun run test:e2e` — all green.

## Outcome

Delivered on branch `bkd/9ia7fzaw`. See [FEAT-001](../task/FEAT-001.md).
