# PLAN-036 Route project detail tabs by URL

- **status**: Completed
- **owner**: l1-lsqiuvv9 / L2 dispatch
- **campaignId**: l1-lsqiuvv9-20260530015043
- **task**: [REFACTOR-007](../task/REFACTOR-007.md)
- **createdAt**: 2026-05-30

## Goal

Make every project detail tab an independent URL route so deep links, browser
back/forward, and detail close/back all resolve to the correct tab. Remove the
`?tab=` search-param tab state.

## Current state

- `apps/web/src/app/routes/_app/projects/$projectId.tsx` validates a `tab`
  search param (`overview|issues|procurement|files`, default `overview`
  dropped) plus a `settings` flag.
- `$projectId.lazy.tsx` renders the whole detail page: header, a shadcn `Tabs`
  whose `value` is `?tab=`, all four tab bodies inline, the settings + delete
  dialogs, and a trailing `<Outlet/>` for the nested detail drawers.
- Nested drawer routes (`$projectId.issues.$issueId`,
  `$projectId.procurements.$procurementId`) render inside that Outlet but portal
  to `<body>`. Fullscreen routes (`$projectId_.issues.$issueId.full`,
  `$projectId_.procurements.$procurementId.full`) opt out of the layout.
- Bugs: procurement drawer/fullscreen close calls `navigate({ to:
  "/projects/$projectId" })` with no `tab`, so it lands on Overview, not
  Procurement. Tab state lives only in the URL search param, not a real route.

## Proposal

Convert `$projectId` into a layout route with child routes per tab.

### Route tree

- `$projectId.tsx` (layout def) — drop `tab` from the search schema; keep
  `settings`. Export the tab/route mapping helpers.
- `$projectId.lazy.tsx` (layout component) — header (title/status/code +
  settings/delete), tab nav driven by the active child route, settings + delete
  dialogs, `<Outlet/>`. No tab bodies.
- `$projectId.index.tsx` / `.lazy.tsx` — Overview (`<ProjectOverviewTab>`).
- `$projectId.issues.tsx` / `.lazy.tsx` — Work orders list
  (`<ProjectIssuesTab>`) + `<Outlet/>` for the issue drawer.
- `$projectId.procurements.tsx` / `.lazy.tsx` — Procurement list
  (`<ProjectProcurementTab>`) + `<Outlet/>`; guards `procurement.view`.
- `$projectId.files.tsx` / `.lazy.tsx` — `<FileBrowser>`.
- Existing drawer/fullscreen routes unchanged except their close/back targets.

Each tab route fetches its own project/members/users via the shared React Query
hooks (same pattern the drawers already use; cache dedupes requests).

### Active tab + navigation

- A pure helper maps the current pathname to the active tab and a tab to its
  route, kept in `-project-tabs.ts` and unit-tested.
- Tab nav uses the shared `Tabs` styling but navigates on change.
- Close/back targets: issue → `/issues`, procurement → `/procurements`.
- Overview `onOpenTab(tab)` callback is preserved; the index route wires it to
  `navigate` (issues / procurements).

### Out of scope / preserved

- No new tabs, no renamed product labels (i18n `tabs.*` unchanged). Route
  segment for procurement is `procurements` to match the existing drawer route.
- Settings deep link, delete, members, uploads, comments, pin, fullscreen
  maximize all preserved.

## Risks

- File-based route nesting: `$projectId.issues.tsx` must render an `<Outlet/>`
  so the existing `$projectId.issues.$issueId` drawer still mounts.
- Per-route refetch of project/members — mitigated by React Query cache.
- Shared main tree has unrelated dirty edits (index.lazy.tsx, seed.ts, docs
  indexes); do not touch them. Only `$projectId*` files + tab components.

## Verification

- `bun run --filter web test` for the projects route folder.
- `bun run --filter web typecheck`.
- Manual reasoning for back/forward + close/back per route.

## Notes

- 2026-05-30 - Plan recorded; implementing directly as a single coupled change.
- 2026-05-30 - Done. New files: `-project-tabs.ts` (+ test), `$projectId.index`,
  `$projectId.issues`, `$projectId.procurements`, `$projectId.files` (each
  `.tsx` route def + `.lazy.tsx` component). Modified: `$projectId.tsx`
  (search schema → settings only), `$projectId.lazy.tsx` (now the layout),
  the four drawer/fullscreen close/back targets, `$projectId.search.test.ts`.
  typecheck + lint clean; 155 project tests pass; route tree regenerated.
