# REFACTOR-019 Global toggle-driven FileBrowser (features config) + built-in preview + consumer migration

- Status: In Progress
- Plan: [PLAN-061](../plan/PLAN-061.md)
- Owner: BKD L3 1tlij9eu (campaign l1-75ymcfnr-filprev-20260603172034)
- Campaign: l1-75ymcfnr-filprev-20260603172034
- Supersedes: [FIX-035](FIX-035.md)
- Updated: 2026-06-03

## Goal

Make `-file-browser.tsx` the single global file component driven by ONE
declarative `features` config. Built-in preview is one toggle (fixes the
project-files no-preview bug). Migrate all 4 consumer call-sites to the new API.

## Scope (edit only)

- `apps/web/src/app/routes/_app/-file-browser.tsx` (core refactor)
- `apps/web/src/app/routes/_app/drive.lazy.tsx` (×2 FileBrowser call-sites)
- `apps/web/src/app/routes/_app/projects/$projectId.files.lazy.tsx`
- `apps/web/src/app/routes/_app/ships/-ship-files-tab.tsx`
- FileBrowser test(s) (co-located `-file-browser.test.tsx`, create/extend)

## New API + feature toggles

See [PLAN-061](../plan/PLAN-061.md) for the full table. `features` optional,
missing keys default ON: `search`, `breadcrumb`, `preview`, `upload`, `create`,
`share`, `versionHistory`, `manage`, `spreadsheetRoute`. Keep optional
`onPreviewEntry?` / `onShareEntry?` overrides. `manage` is ALSO gated by the
existing `canManage` master switch. `preview` renders the self-contained
`<FilePreviewDialog>` with `readOnly={!canManage}` for normal files; `.sheet`
routes to `/drive/sheet/$entryId` when `spreadsheetRoute` is on.

## Verified facts (do not re-investigate)

- Sheet route top-level: `drive_.sheet.$entryId.tsx` → works from any context.
- `useShare()` app-wide (`providers.tsx:105` mounts `ShareDialogHost`).
- `FilePreviewDialog` self-contained (own fetch/download/version-history).

## Acceptance

- Project & ship files tabs preview previewable files; readOnly follows
  canManage. Drive preview/share/create/version-history/spreadsheet-open all
  still work; no duplicate dialog. Toggled-off features absent where disabled.
- `bun run check` EXIT=0 (modulo @milkdown flake); FileBrowser tests pass.
- Merge target: L2 merges `--no-ff` into `bkd/lkiwea9v`.

> Full self-contained implementation spec is delivered to L3 `1tlij9eu` via the
> BKD follow-up (L3 worktrees branch from `main` and do not contain this file).
