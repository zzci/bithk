# FEAT-019 — Projects list tag filter multi-select

- Status: Completed (on bkd/t48nsbav; awaits L1 review + merge to main)
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
- 2026-06-03: **L3-2 (jyv3hgu6) MERGED** into bkd/t48nsbav (--no-ff, merge
  25c7801; L3 commit 1431801). `ProjectsQuery.tagId` → `tagIds[]`; `useProjects`
  sends repeatable SORTED `tagIds` (stable cache key); `projectsFilterToQuery`
  maps status only; `index.lazy.tsx` splits the conflated `filter` into `status`
  (single) + `selectedTagIds` (string[] multi) with the tags dimension
  `mode:"multi"` (removable chips). No `ListFilter` change, NO new i18n keys
  (reused field.tags/field.status/list.filterRemove/list.clearFilters/
  status.active/status.archived; en+zh parity intact). 6 web project files +
  tests. **Both lanes merged; campaign implementation COMPLETE on bkd/t48nsbav
  (25c7801) — awaits L1 review + merge to main.** Post-merge `bun run check`
  EXIT 0 (api 1439+368, web 667 [+2 multi-select tests], typecheck/build/i18n[20
  ns in sync]/env/api-docs green). NOTES: (1) same commit-gap — L3 ran check
  green but forgot to commit; L2 committed its work. (2) main advanced
  66b1897→b082153 mid-campaign via a FOREIGN concurrent ship-list multi-tag
  campaign; BKD cut the L3-2 worktree from the new main, so its branch carried
  the ship delta. L2 stashed → `git reset --hard bkd/t48nsbav` → re-applied ONLY
  the 6 web project files (verified identical across both bases) → committed →
  merged, keeping bkd/t48nsbav scoped to ONLY this campaign (no ship commit).
  L1's merge to main will be a clean 3-way (disjoint files).
