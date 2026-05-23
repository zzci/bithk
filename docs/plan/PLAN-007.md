# PLAN-007 — Global search module + command palette

- **Status:** Done
- **Task:** [FEAT-006](../task/FEAT-006.md)
- **Updated:** 2026-05-23

## Goal

Add a sidebar search entry that opens a command-palette dialog. The dialog
offers quick entries (navigation shortcuts) and global content search across
documents, issues, projects, and drive files. Search is permission-scoped by
reusing each module's existing access-scoped list functions — no new
permission logic.

## Backend

1. `project.service.ts`: extend `ListProjectParams` with `q`; filter on
   `projects.name`/`projects.code` (LIKE, escaped) → verify: unit test that a
   query matches by name and by code.
2. `drive.service.ts`: add `searchDriveEntries(db, { userId, q, limit })`.
   Scope = personal drive (owner_type=user, owner_id=user) + team directories
   from `listTeamDirectories(db, userId)` + project drives from
   `listProjects(db, { memberUserId })`. Match `drive_entries.name` LIKE,
   status=normal → verify: a member sees a matching file in a team dir; a
   non-member does not.
3. New `modules/search`: `search.service.ts` `globalSearch(db, { userId,
   isAdmin, q, limit })` fans out to `listMyDocuments` / `listIssues` |
   `listMyIssues` / `listProjects` / `searchDriveEntries` and maps rows to a
   uniform `SearchHit` ({ type, id, title, subtitle? }). `search.routes.ts`
   `GET /search?q=&limit=` (authRequired) returns grouped hits. `index.ts`
   exports `searchRoutes` → verify: handler test returns only the caller's
   visible hits.
4. `routes/protected.ts`: mount `searchRoutes()` → verify: typecheck.
5. `search.test.ts`: permission scoping across the four sources.

## Frontend

6. `shared/lib/api/search.ts`: `SearchHit` types + `useGlobalSearch(query)`
   TanStack Query hook (debounced caller-side, `enabled` on non-empty q).
7. `shared/components/command-palette.tsx`: rewrite the search panel as a
   `Dialog` command palette — search input, quick-entry list (from
   `getNavItems`, role-filtered) shown when the query is empty, grouped
   results when querying, keyboard up/down + Enter, navigate + close on
   select.
8. Sidebar integration: a "Search" trigger item at the top of the nav (icon +
   `⌘K` hint, tooltip in collapsed mode) and a global `⌘/Ctrl+K` listener;
   mount the palette. `⌘B` (sidebar toggle) is untouched.
9. i18n: add `search`, `searchPlaceholder`, `quickEntry`, `results`,
   `noResults` under `nav`/a `search` block in `common.json` (zh + en).
10. `command-palette.test.tsx`: empty-query shows quick entries; querying
    renders grouped hits; role filter hides admin entries for members.

## Scope / limitations

- Drive results navigate to `/drive` root — the drive route has no
  deep-linking search params yet, so a file hit cannot open its folder/preview
  directly. Documents/issues/projects deep-link via their short-id routes.
- No new search index/table; LIKE over existing columns. Acceptable at current
  data scale (R&D phase, breaking changes allowed).

## Verify

- Backend `search.test.ts` (4 cases) and frontend `command-palette.logic.test.ts`
  (5 cases) pass.
- `@app/web` typecheck clean; this feature's files lint clean.
- The frontend test follows the repo's logic-unit pattern (no DOM harness
  exists): pure helpers `hitTarget` / `matchesQuery` were split into
  `command-palette.logic.ts` and tested there.

> Note: at completion the repo-wide `bun run check` is red solely due to a
> concurrent document-module change (per-user pin, FEAT-007/PLAN-008) leaving
> `document.service.ts` mid-edit. No file owned by this task is affected.
