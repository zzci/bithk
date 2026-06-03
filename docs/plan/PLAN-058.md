# PLAN-058 Projects list tag filter multi-select

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 t48nsbav
- **campaignId**: l1-75ymcfnr-projmtag-20260603162708
- **tasks**: [FEAT-019](../task/FEAT-019.md)
- **createdAt**: 2026-06-03

## Goal

Make the PROJECTS LIST tag filter multi-select. Today the list filters by a
SINGLE tag: one `filter` string holds EITHER a status (`__active__` /
`__archived__`) OR exactly one tag id, and the `ListFilter` tags dimension is
`mode: "single"`. Switch it to multi-select so several tags can be applied at
once, mirroring the existing issues / procurement multi-tag list filters.

## Semantics — OR / union (mirror issues & procurement)

The issue and procurement list filters already implement multi-tag with **OR /
union** semantics (a row matches if it carries ANY of the selected tags) via
`listResourceIdsByAnyTag`:

- `apps/api/src/modules/issue/issue.service.ts:445` (`tagIds` → `listResourceIdsByAnyTag(db, issueTagBinding, …)`)
- `apps/api/src/modules/procurement/procurement.service.ts:448` (same shape)
- Route parsing helper `parseTagIds` (repeated `?tagIds=a&tagIds=b` + comma
  `?tagIds=a,b`, de-duplicated, capped 50): `apps/api/src/modules/issue/issue.routes.ts:86`.

Projects must replicate the SAME OR semantics for consistency. The project list
query currently uses the single-tag helper `listResourceIdsByTag`
(`apps/api/src/modules/project/project.service.ts:374-379`).

Status filter (active / archived, single-select) is UNCHANGED.

## Scope / Constraints

- Backend: `apps/api/src/modules/project/project.routes.ts` (listSchema +
  GET /projects query parsing), `apps/api/src/modules/project/project.service.ts`
  (`ListProjectParams` + `listProjects` tag query), tests.
- Frontend: `apps/web/src/shared/lib/api/projects.ts` (`ProjectsQuery` +
  `useProjects` + `projectKeys.list` cache key),
  `apps/web/src/app/routes/_app/projects/-project-form-logic.ts`
  (`projectsFilterToQuery`),
  `apps/web/src/app/routes/_app/projects/index.lazy.tsx` (split filter state),
  tests. Reuse existing i18n keys; add only if needed (en+zh parity).
- Dev phase: breaking changes OK (the old single `tagId` param may be removed),
  DB resettable, no compat shims.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown teardown
  flake (exit1 with 0 real test failures).
- The shared `ListFilter` component already supports `mode: "multi"` with
  removable selected chips (`apps/web/src/shared/components/list-filter.tsx`);
  no change to that component is required.

## Acceptance Criteria

- Backend `GET /projects` accepts a repeatable / comma-separated `tagIds` query
  and filters projects by OR / union over those tags (match ANY); the old
  single `tagId` param is removed.
- `listProjects` filters by `tagIds[]` via `listResourceIdsByAnyTag`; status
  (active/archived) filtering is unchanged.
- The projects list `ListFilter` tags dimension is `mode: "multi"`; status
  stays single. Selected tags render as removable chips.
- `useProjects` sends `tagIds[]`; the query cache key stays stable regardless
  of selection order.
- i18n en+zh parity; `bun run check` EXIT=0 (modulo the @milkdown flake).

## Decomposition (2 L3, serialized: frontend depends on the tagIds API)

1. **L3-1 backend** — `project.routes.ts` (drop `tagId`; parse repeatable +
   comma `tagIds` like `issue.routes.ts` `parseTagIds`; pass `tagIds` to
   `listProjects`) + `project.service.ts` (`ListProjectParams.tagId` →
   `tagIds[]`; `listProjects` uses `listResourceIdsByAnyTag`; import swap) +
   service/route tests (OR semantics, repeated + comma forms).
2. **L3-2 frontend** (deps: L3-1 merged) — `projects.ts` (`ProjectsQuery.tagId`
   → `tagIds[]`; `useProjects` builds repeatable sorted `tagIds`; cache key
   stable join) + `-project-form-logic.ts` (`projectsFilterToQuery` → status-only
   mapping, tagIds passed separately) + `index.lazy.tsx` (split conflated
   `filter` into `status` single + `selectedTagIds` multi; tags dimension
   `mode: "multi"`) + tests.

   Note: backend (`apps/api/**`) and frontend (`apps/web/**`) files are
   DISJOINT, so each L3 passes `bun run check` independently; L3-2 is sequenced
   after L3-1 only to honor the API-contract dependency in the integrated
   branch.
