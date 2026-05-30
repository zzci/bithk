# REFACTOR-007 Route project detail tabs by URL

- **status**: Completed
- **priority**: P2
- **owner**: l1-lsqiuvv9 / L2 dispatch
- **plan**: [PLAN-036](../plan/PLAN-036.md)
- **campaignId**: l1-lsqiuvv9-20260530015043
- **createdAt**: 2026-05-30

## Description

Refactor the project detail tabs (Overview, Work orders, Procurement, Files) so
each tab is an independent URL route instead of the `?tab=` search-param state
held in `$projectId.lazy.tsx`. Browser back/forward and the issue/procurement
detail close/back flows must return to the correct tab route and never fall back
to Overview.

User request: project detail tabs should use URL routing; each tab an
independent route; back navigation must not return to the wrong tab. Breaking
changes are acceptable (R&D stage).

## Acceptance criteria

See [PLAN-036](../plan/PLAN-036.md). Summary:

- Each tab is a first-class child route under `/projects/$projectId`:
  - `/projects/$projectId` → Overview (index)
  - `/projects/$projectId/issues` → Work orders
  - `/projects/$projectId/procurements` → Procurement
  - `/projects/$projectId/files` → Files
- The `tab` search param is removed; `$projectId` becomes a layout that renders
  the header + tab nav + `<Outlet/>`.
- Existing issue/procurement drawer + fullscreen routes still work; their
  close/back lands on the owning tab route (procurement close no longer falls
  back to Overview).
- Settings deep link (`?settings=true`), delete, members/permissions, uploads,
  comments, pin, and i18n behavior preserved.
- Focused tests cover tab-route mapping and the search-schema change; web
  typecheck + focused project tests green.

## Notes

- 2026-05-30 - L2 bootstrap: investigation + proposal recorded; tightly-coupled
  frontend refactor, implemented directly (no L3 fan-out, no file overlap).
- 2026-05-30 - Implemented: `$projectId` converted to a layout
  (header + route-driven tab nav + `<Outlet/>`); added per-tab routes
  (`$projectId.index`, `.issues`, `.procurements`, `.files`, each `.tsx` +
  `.lazy.tsx`); added pure `-project-tabs.ts` mapping helper. Issue/procurement
  drawer + fullscreen close/back now target `/issues` and `/procurements`
  (procurement no longer falls back to Overview). `tab` search param removed
  from the schema; `settings` flag kept. Verified: web typecheck clean, lint
  clean, 155 project route tests pass (incl. new `-project-tabs.test.ts` and the
  updated search-schema test), regenerated `routeTree.gen.ts` nests the drawer
  routes under their tab routes. Full `bun run check` not run end-to-end (web
  branch-coverage gate pre-existing-red ~3.99%); targeted gates green. Awaiting
  human verification before BKD move-to-done.
