# PLAN-061 Global toggle-driven FileBrowser module

- **status**: In Progress
- **owner**: l1-75ymcfnr / L2 lkiwea9v
- **campaignId**: l1-75ymcfnr-filprev-20260603172034
- **supersedes**: [PLAN-060](PLAN-060.md)
- **tasks**: [REFACTOR-019](../task/REFACTOR-019.md)
- **createdAt**: 2026-06-03

## Goal

Refactor `apps/web/src/app/routes/_app/-file-browser.tsx` into the single global
file component used consistently by every file surface. Replace the scattered
booleans (`showTitle` / `showSearch`) and the ad-hoc presence-based behavior
(`onShareEntry` / `onPreviewEntry` "is it passed?") with ONE declarative
`features` config object. Each surface enables exactly what it needs and behaves
consistently. Built-in **preview** becomes one feature toggle — fixing the
project-files no-preview bug as a side effect.

## Root problem this also fixes

The project files tab and ship files tab render `<FileBrowser>` with no
`onPreviewEntry` and no `<FilePreviewDialog>`, so opening a file is a no-op (no
preview). Only `drive.lazy.tsx` wires preview. Making preview a built-in,
default-on feature of FileBrowser fixes this everywhere.

## New API

```tsx
<FileBrowser
  owner={{ ownerType, ownerId }}
  canManage
  rootLabel="…"
  features={{ search: false, breadcrumb: false, preview: true /* … */ }}
  onPreviewEntry={…}   // optional override (drive special cases)
  onShareEntry={…}     // optional override
/>
```

- `features` is OPTIONAL; every missing key defaults to **enabled** (all ON).
- Keep `owner` / `canManage` / `rootLabel` semantics. (Either keep
  `ownerType`/`ownerId` flat or group under `owner` — implementer's choice, but
  migrate ALL call-sites consistently. Dev phase: breaking signature OK.)
- Keep optional `onPreviewEntry?` / `onShareEntry?` override hooks for the drive
  page's special routing (no drive regression).

### Feature toggles (all boolean, default ON)

| key | controls |
| --- | --- |
| `search` | the search box |
| `breadcrumb` | title / root crumb (was `showTitle`) |
| `preview` | built-in `<FilePreviewDialog>` for normal files (respects `canManage`→`readOnly`) |
| `upload` | upload affordances |
| `create` | new folder / text / spreadsheet affordances |
| `share` | share action (FileBrowser owns it via app-global `useShare()`; `onShareEntry?` overrides) |
| `versionHistory` | version-history action |
| `manage` | rename / move / trash / favorite (ALSO gated by `canManage` master switch) |
| `spreadsheetRoute` | Univer `.sheet` open routing → `/drive/sheet/$entryId` |

## Established facts (verified by L2)

- `/drive/sheet/$entryId` is a TOP-LEVEL flat route
  (`apps/web/src/app/routes/_app/drive_.sheet.$entryId.tsx`), so spreadsheet
  open works from any context (project/ship) — `spreadsheetRoute` stays ON
  everywhere.
- `ShareDialogHost` is mounted app-root (`apps/web/src/app/providers.tsx:105`),
  so `useShare()` works app-wide → FileBrowser can own share internally,
  making share consistent across surfaces (project/ship gain it when enabled).
- `<FilePreviewDialog>` (`-file-preview-dialog.tsx`) is self-contained: fetches
  its own bytes (`httpRaw('/drive/entries/:id/content?inline=true')`), downloads
  via `downloadDriveEntry`, renders its own version-history dialog.

## Consumer migration (consistency is the point)

- `drive.lazy.tsx` (×2 FileBrowser: team-directory + my-files): all features ON
  (current behavior). It keeps its own `onPreviewEntry`/`onShareEntry` overrides
  for the non-FileBrowser lists; spreadsheets still open the sheet editor. Drop
  the now-redundant locally-rendered preview only if FileBrowser fully owns it
  for the FileBrowser surfaces — but drive.lazy MUST keep its own
  `<FilePreviewDialog>` for the recent/favorites/trash/share-lists/sidebar
  (those are NOT FileBrowser). No drive regression.
- `projects/$projectId.files.lazy.tsx`: `features={{ search:false,
  breadcrumb:false, preview:true, manage per caps }}` → project files now
  preview (the reported bug) + consistent.
- `ships/-ship-files-tab.tsx`: same posture as project files.

## Scope / Constraints

- Frontend only; keep diffs scoped to FileBrowser + its 4 consumer call-sites +
  tests.
- Dev phase: breaking changes OK; no compat shims.
- Quality gate: `bun run check` EXIT=0 (fresh worktree → `bun install` first);
  only acceptable noise = the known `@milkdown/ctx` teardown flake.

## Acceptance Criteria

- FileBrowser exposes a `features` config; missing keys default to enabled.
- Project & ship files tabs preview previewable files (image/pdf/text/md/code);
  `readOnly` follows `canManage`.
- Drive: preview + share + create + version-history + spreadsheet-open all STILL
  work (no regression); no duplicate preview dialog.
- `.sheet` opens the sheet editor from every context.
- Toggled-off features are absent on the surfaces that disable them.
- All consumers migrated to the new API; `bun run check` EXIT=0 (modulo
  @milkdown flake); new/updated FileBrowser tests pass.

## Decomposition (1 L3 — tightly coupled)

Single L3 ([REFACTOR-019](../task/REFACTOR-019.md)): the `features` API + built-in
preview + internal toggles + all 4 consumer migrations + tests, as one
self-consistent change. Splitting core-vs-consumers fails because a consumer L3
would branch from stale `main` lacking the new API (compile break + merge
conflict). One cohesive `apps/web` unit passes `bun run check` together.
