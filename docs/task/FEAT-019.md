# FEAT-019 — Projects list tag filter multi-select

- Status: In Progress
- Plan: [PLAN-058](../plan/PLAN-058.md)
- Campaign: l1-75ymcfnr-projmtag-20260603162708
- Owner: L2 t48nsbav dispatch
- Created: 2026-06-03

## Summary

Convert the projects LIST tag filter from single-select to MULTI-select with
OR / union semantics (a project matches if it carries ANY of the selected tags),
mirroring the existing issues and procurement multi-tag list filters. The status
filter (active / archived) stays single-select and unchanged. The shared
`ListFilter` component already supports `mode: "multi"`, so the change is to the
project list query (backend) and the projects-list page state + API client
(frontend).

## Lanes (L3)

- **L3-1 backend** — `apps/api/src/modules/project/project.routes.ts` (drop the
  single `tagId` from `listSchema`; parse repeatable + comma-separated `tagIds`
  via a `parseTagIds` helper mirroring `issue.routes.ts`; pass `tagIds` to
  `listProjects`) + `project.service.ts` (`ListProjectParams.tagId` →
  `tagIds?: readonly string[]`; `listProjects` filters via
  `listResourceIdsByAnyTag` for OR semantics; swap the import) + service/route
  tests for OR / union (repeated + comma forms).
- **L3-2 frontend** (deps: L3-1) — `apps/web/src/shared/lib/api/projects.ts`
  (`ProjectsQuery.tagId` → `tagIds[]`; `useProjects` sends repeatable sorted
  `tagIds`; `projectKeys.list` cache key uses a stable join) +
  `-project-form-logic.ts` (`projectsFilterToQuery` → status-only mapping,
  tagIds threaded separately) + `index.lazy.tsx` (split the conflated `filter`
  state into `status` single + `selectedTagIds` string[]; tags dimension
  `mode: "multi"` with removable chips) + tests. Reuse existing i18n keys
  (en+zh parity); add only if needed.

## Status notes

- 2026-06-03: Investigation + plan (PLAN-058). Confirmed the OR-semantics helper
  `listResourceIdsByAnyTag` and the `parseTagIds` route helper already exist
  (issues + procurement), and `ListFilter` already supports `mode: "multi"` with
  removable chips. Backend and frontend files are disjoint. L3-1 dispatched
  (working); L3-2 created (planned, deps=L3-1).
- 2026-06-03: **L3-1 (y8sp6fr1) MERGED** into bkd/t48nsbav (--no-ff, merge
  63e554f; L3 commit 22fd187). `GET /projects` drops the single `tagId` and now
  parses repeatable + comma `tagIds` (via a `parseTagIds` helper mirroring
  `issue.routes.ts`) filtered by OR/union through `listResourceIdsByAnyTag`;
  `ListProjectParams.tagId` → `tagIds[]`; tests cover empty/single/union/AND-not-
  applied (service) + repeated+comma route form. 4 files, all apps/api project
  module. Post-merge `bun run check` EXIT 0 (api 1439, web 665, build/i18n/env/
  api-docs green). NOTE: the L3 ran check green but forgot to commit; L2
  committed its in-scope working-tree changes on the L3 branch (sanctioned git
  op) then merged — BKD commit-gap pattern. L3-2 (jyv3hgu6) dispatched (working).
