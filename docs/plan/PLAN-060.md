# PLAN-060 File preview built into the shared FileBrowser

- **status**: In Progress
- **owner**: l1-75ymcfnr / L2 lkiwea9v
- **campaignId**: l1-75ymcfnr-filprev-20260603172034
- **tasks**: [FIX-035](../task/FIX-035.md)
- **createdAt**: 2026-06-03

## Goal

Make the shared `FileBrowser` render the file preview itself, so every consumer
(project files tab, ship files tab, drive team directories / my-files) gets
preview by default with zero extra wiring — matching the drive page experience.

## Bug + root cause

The project files tab
(`apps/web/src/app/routes/_app/projects/$projectId.files.lazy.tsx`) and the ship
files tab (`apps/web/src/app/routes/_app/ships/-ship-files-tab.tsx`) both render
the shared `<FileBrowser ownerType="project">` but pass **no** `onPreviewEntry`
and render no dialog. `FileBrowser` exposes an OPTIONAL `onPreviewEntry?`
callback and calls it on open (`-file-browser.tsx:298-302`) but does NOT render
`<FilePreviewDialog>` itself. Only `drive.lazy.tsx` wires it (passes
`onPreviewEntry={openPreview}` and renders `<FilePreviewDialog>` at
`drive.lazy.tsx:88-95,183,189-196`). Result: opening a file in a project/ship
files tab is a no-op — no preview. Drive works only because the drive page
renders the dialog itself.

## Fix (integrate preview into the shared component)

Move preview ownership into `FileBrowser`:

- `-file-browser.tsx` gains internal preview state and renders
  `<FilePreviewDialog>` (from `./-file-preview-dialog`). `FilePreviewDialog` is
  already self-contained — it fetches its own bytes via `httpRaw`
  (`/drive/entries/:id/content?inline=true`), handles download via
  `downloadDriveEntry(entry)`, and renders its own version-history dialog. So
  `FileBrowser` only needs to render it with `entry` + `open` + `onOpenChange`
  + `readOnly` + `initialEditing`. No extra content/download wiring is required.
- When a file is opened and the parent supplied **no** `onPreviewEntry`,
  `FileBrowser` opens its internal preview. Univer spreadsheets (`.sheet`,
  `isUniverSheetEntry`) still route to `/drive/sheet/$entryId` via the existing
  `openSheet` navigation — only NORMAL files use the preview dialog.
- `onPreviewEntry?` stays an OPTIONAL override: if a parent supplies it
  (drive.lazy keeps its own — it also drives the recent/favorites/trash/shared
  lists and sidebar, which are NOT `FileBrowser`), `FileBrowser` defers to the
  parent and does NOT render its own dialog (no drive regression).
- `readOnly` honors the consumer's `canManage` (`readOnly={!canManage}`) so
  preview edit/save controls match permissions (project files use
  `caps.canManageFiles`; ship files use `caps.canManageProject`).

## Scope / Constraints

- Frontend only.
  - EDIT: `apps/web/src/app/routes/_app/-file-browser.tsx` (own the preview).
  - drive.lazy.tsx: keeps its `onPreviewEntry` override + its own
    `<FilePreviewDialog>` (needed for the non-FileBrowser lists) — no change
    required, no regression. (L3 may leave it untouched.)
  - `$projectId.files.lazy.tsx` / `-ship-files-tab.tsx`: no change needed —
    they self-serve once FileBrowser owns preview (they already pass
    `canManage`, which drives `readOnly`).
- Dev phase: breaking changes OK; DB resettable; no compat shims.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known `@milkdown/ctx`
  teardown flake (exit1 with 0 real test failures).

## Acceptance Criteria

- Project files tab: clicking a previewable file (image / pdf / text / markdown
  / code) opens the preview dialog, like drive.
- Ship files tab: same preview behavior (it shares the project `FileBrowser`).
- Spreadsheets (`.sheet`) opened from a project/ship tab still open the dedicated
  sheet editor route (`/drive/sheet/$entryId`) — NOT the preview dialog.
- Download and version-history work from the preview in the project context.
- Drive page: preview STILL works (no regression); spreadsheets still open the
  sheet editor.
- `readOnly` reflects `canManage` (viewers cannot edit/save).
- `bun run check` EXIT=0 (modulo the @milkdown flake); new FileBrowser
  preview-open test(s) pass.

## Decomposition (1 L3)

1. **L3-1** ([FIX-035](../task/FIX-035.md)) — implement internal preview in
   `-file-browser.tsx` (state + dialog render + optional-override semantics +
   spreadsheet routing + `readOnly` from `canManage`) and add a FileBrowser
   preview-open test. Single self-contained frontend change.
