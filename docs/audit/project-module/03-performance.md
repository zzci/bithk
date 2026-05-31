# Project Module Audit — Lane 03: Performance

Counts: **P0 x0  P1 x4  P2 x4  P3 x3**

Scope: N+1 queries, missing indexes, request waterfalls, over-fetching, list
pagination, and React re-render/re-query cost across the project module
(backend `apps/api/src/modules/{project,tag,issue,procurement}`, frontend
`apps/web/src/app/routes/_app/projects/*`). Read-only investigate-phase audit —
no source touched.

---

## P1 — High

### F1: Issue list `composeIssue` runs 3 queries per row (N+1)
- **Severity:** P1
- **Location:** `apps/api/src/modules/issue/issue.service.ts:412-414` (loop) →
  `composeIssue` `issue.service.ts:94-121`; helpers `getAssigneeId:75-86`,
  `projectShortId:88-92`.
- **Description:** `listByProject` loads the page rows, then for each row calls
  `await composeIssue(db, r, undefined, tagMap.get(r.id))`. With `details`
  undefined, `composeIssue` executes per row: (1) `issueDetails` lookup
  (`:100`), (2) `getAssigneeId` → a `relation_tuples` query (`:101`), (3)
  `projectShortId` → a `projects` query (`:112`). Tags are the only batched
  field. For a 20-row page that is ~60 extra round-trips on top of the list
  query. Worse, `projectShortId` resolves the **same** project short id N times —
  every row in a `listByProject` result shares one `projectId`.
- **Impact:** Issue list latency grows linearly with page size; each of the 5
  per-status list calls (see F2) pays this independently. On bun:sqlite the
  queries are synchronous-ish but still per-statement overhead × rows × 5
  statuses per render.
- **Recommended fix (not applied):** Mirror the procurement list (which is
  already correct, `procurement.service.ts:456-466`): `innerJoin` `items` with
  `issueDetails` so details come back with the row; resolve `projectShortId`
  once for the whole page (all rows share the project); and batch-load assignee
  tuples with a single `inArray(relationTuples.objectId, rowItemIds)` query,
  then map in memory. Add a `composeIssue` overload that accepts the prefetched
  assigneeId so no per-row query remains.

### F2: Issues tab fans out 5 full list requests, one per status
- **Severity:** P1
- **Location:** `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:256-260`
  (`todoQuery`…`cancelQuery`); backend route
  `apps/api/src/modules/issue/issue.routes.ts:138-148`.
- **Description:** The tab issues 5 separate `useProjectIssues(projectId,{status})`
  queries. Each is a full HTTP request that re-runs `requireProjectMember`
  (`resolveProjectId` + `getMemberCapabilities`, 2 queries — `issue.routes.ts:94,100`)
  **plus** the F1/F3 list work **plus** a `count()`. So one render of the tab =
  5 × (2 auth queries + detail scan + count + N+1 compose). Every keystroke-debounced
  search change or tag toggle re-fires all 5 (the query keys include `q`/`tagIds`).
- **Impact:** ~5× backend amplification for a single screen; project id and
  caller capabilities are re-resolved 5 times per render. Tag/search interactions
  multiply it again.
- **Recommended fix (not applied):** Fetch the project's issues **once**
  (single request, no status filter) and group by status on the client — the
  rows already carry `status`. This collapses 5 requests → 1, removes the
  redundant auth re-resolution, and makes counts a client-side reduce. If
  server-side grouping is preferred, add one endpoint that returns
  per-status buckets + counts in a single query.

### F3: Issue `listByProject` does a two-phase unbounded `inArray` instead of a JOIN
- **Severity:** P1
- **Location:** `apps/api/src/modules/issue/issue.service.ts:381-391` (load all
  detail itemIds) and `:408-410` (count + page both keyed on
  `inArray(items.id, detailRows.map(...))`).
- **Description:** Because the priority filter lives on `issue_details` while
  status/title live on `items`, the code first selects **every**
  `issue_details.itemId` for the project (`.all()`, no limit), then feeds that
  into `inArray` for both the `count` and the page query. The IN list grows with
  the project's total issue count, regardless of `page`/`limit`. Even a
  `limit:1` count request (used by the detail tab bar, `$projectId.lazy.tsx:54`)
  loads the project's entire issue id set into memory and builds a giant IN
  clause. Procurement avoids this entirely with an `innerJoin`
  (`procurement.service.ts:444-463`).
- **Impact:** Memory + query-planning cost scale with project size, not page
  size; a large project makes every issue count/list request expensive. SQLite
  also has a default 999-parameter limit that a very large project could hit.
- **Recommended fix (not applied):** `innerJoin items ⋈ issueDetails on
  itemId` and push the `projectId`/`priority` predicates into the joined WHERE,
  exactly like `procurement.service.ts`. Drops the pre-scan, the unbounded IN,
  and lets `LIMIT/OFFSET` bound the work.

### F4: Project list fetches two extra full pages just for status counts
- **Severity:** P1
- **Location:** `apps/web/src/app/routes/_app/projects/index.lazy.tsx:50-51`
  (`activeCountQuery = useProjects({status:"active"})`,
  `archivedCountQuery = useProjects({status:"archived"})`); backend
  `project.service.ts:347-394`.
- **Description:** To render the two filter-chip counts, the page fires two extra
  list requests with default `limit:20`. Each backend `listProjects` returns 20
  fully-composed `ProjectView`s — including `loadTagsByProject` (a `tags_refs ⋈
  tags` query) and `loadCoverUrlsByProject` (a `ships` query + a `file_references`
  query, `project.service.ts:160-192`) — but the UI consumes only `meta.total`.
- **Impact:** 3 list endpoints hit on every project-list mount; ~40 project rows
  composed (tags + cover URL resolution) purely to show two integers.
- **Recommended fix (not applied):** Request `limit:1` for the count queries (or
  add a lightweight counts endpoint / `SELECT status, COUNT(*) … GROUP BY
  status`). Skipping tag/cover composition when only `total` is needed removes
  the bulk of the wasted work.

---

## P2 — Medium

### F5: `searchIssues` is N+1 with no batching at all
- **Severity:** P2
- **Location:** `apps/api/src/modules/issue/issue.service.ts:458-462`.
- **Description:** Global issue search loops `composeIssue(db, r)` with **no**
  prefetched details or tags, so each result row triggers 4 queries:
  `issueDetails` + `getAssigneeId` + `projectShortId` + `listResourceTagViews`
  (`:100-102,112`). Unlike `listByProject` it does not even batch tags.
- **Impact:** Search latency = 4 × resultCount round-trips; spans multiple
  projects so `projectShortId` cannot be resolved once.
- **Recommended fix (not applied):** Same batching as F1 plus a single
  `loadResourceTagsByResource` over all result item ids, and a batched
  `projects.shortId` lookup keyed by the distinct `projectId`s.

### F6: No standalone index on `project_members.user_id`
- **Severity:** P2
- **Location:** schema `apps/api/src/modules/project/schema.ts:89-95`; hot
  callers `project.service.ts:370-373` (`listProjects` member scope),
  `issue.service.ts:443-446` (`searchIssues` scope), `project.service.ts:641-645`
  (`isMember`).
- **Description:** The only indexes are `project_members_project_idx(projectId)`,
  `project_members_role_idx(roleId)`, and the unique
  `(projectId, userId)`. A query filtering by **userId alone** cannot use the
  composite unique index (userId is the trailing column), so
  `listProjects({memberUserId})` — which runs on **every** non-admin project list
  request — does a full table scan of `project_members`. `getMemberCapabilities`
  is fine because it filters `(projectId, userId)` and hits the unique index.
- **Impact:** Project list and issue search degrade with total membership rows
  across all projects, not just the caller's.
- **Recommended fix (not applied):** Add `index("project_members_user_idx").on(t.userId)`
  (or reorder a composite to lead with userId). Verify the dev DB is
  migrate-on-boot so the new index applies on restart.

### F7: `loadResourceTagsByResource` runs a correlated COUNT subquery per (row,tag)
- **Severity:** P2
- **Location:** `apps/api/src/modules/tag/tag.service.ts:235-245` (the
  `usageCount` correlated subquery at `:240`).
- **Description:** When embedding tags on list rows, each returned `tags_refs`
  row carries `usageCount` computed via
  `(SELECT COUNT(*) FROM tags_refs WHERE tag_id = tags.id)`. For a 20-issue page
  where issues carry several tags each, that's dozens of correlated COUNT
  subqueries per list call (and the issue tab issues 5 such calls — F2). The
  `tags_refs_tag_id_idx` makes each COUNT indexed, but the count is recomputed
  redundantly for every occurrence of the same tag.
- **Impact:** O(rows × tagsPerRow) subqueries; amplified 5× by the status
  fan-out. The embedded `usageCount` is only meaningfully used by the filter
  vocabulary, not the row badges (`-project-issues-tab.tsx:415-419` renders only
  `tag.name`).
- **Recommended fix (not applied):** Compute per-tag usage once via a single
  `GROUP BY tag_id` aggregate joined in, or drop `usageCount` from the embedded
  row view entirely (the dedicated `/tags` vocabulary endpoint already supplies
  counts for the filter UI via `listTagsWithUsage:58-71`).

### F8: Overview + detail tab bar issue redundant count vs. latest queries
- **Severity:** P2
- **Location:** `$projectId.lazy.tsx:54-55` (`useProjectIssues(...,{limit:1})`,
  `useProcurements(...,{limit:1})`) vs. `-project-overview-tab.tsx:40-41`
  (`useProjectIssues(...,{limit:5})`, `useProcurements(...,{limit:5})`).
- **Description:** On the overview route both the layout (count, `limit:1`) and
  the overview tab (latest, `limit:5`) are mounted. They differ only by `limit`,
  so they are distinct TanStack Query keys (`projectKeys.issues` includes the
  serialized query string, `projects.ts:146,516`) and produce **two** issue list
  requests + **two** procurement list requests for the same data — the `limit:5`
  response already contains `meta.total`.
- **Impact:** 2 redundant list round-trips per overview mount, each carrying the
  F1/F3 backend cost.
- **Recommended fix (not applied):** Derive the tab-bar count from the
  `limit:5` overview query's `meta.total` (lift the query or share via cache), or
  standardize both on one limit so the query keys coincide and TanStack Query
  dedupes them.

---

## P3 — Low / Nit

### F9: `backfillProjectRoles` is a per-project query loop at boot
- **Severity:** P3
- **Location:** `apps/api/src/modules/project/project.roles.ts:255-266`.
- **Description:** Boot-time backfill iterates every project and runs a separate
  `project_roles` SELECT per project, then a transaction per project. Not on any
  request path, but cost grows linearly with project count on every server boot.
- **Impact:** Slower cold start as projects accumulate; no user-facing latency.
- **Recommended fix (not applied):** Load all roles once
  (`select … where projectId in (allIds)` or a single ordered scan) and group in
  memory; keep the per-project transaction only for the rare write case (skip
  projects already fully correct without opening a tx).

### F10: Project list search filters only the current page; server `q` unused
- **Severity:** P3
- **Location:** `apps/web/src/app/routes/_app/projects/index.lazy.tsx:62-72`
  (client-side `visibleProjects` filter); backend already supports `q`
  (`project.service.ts:356-362`).
- **Description:** The list search box filters `projectsQuery.data` (only the
  loaded 20-row page) in JS instead of passing `q` to the API. Results are both
  incomplete (matches beyond the current page never appear) and a wasted-fetch
  pattern (the page may be mostly filtered out client-side). The backend `LIKE`
  search with `escapeLike` is ready but unused here (it is used by issues/
  procurement tabs).
- **Impact:** Mostly correctness/UX, but performance-relevant: pagination +
  client filter means more pages fetched to find matches than a server `q` would.
- **Recommended fix (not applied):** Debounce the input and pass `q` to
  `useProjects`, dropping the client-side filter, so the server returns the
  correct, paginated result set.

### F11: Large tabs not memoized; inline callbacks recreate each render
- **Severity:** P3
- **Location:** `-project-issues-tab.tsx` (`toggleTag:246`, `openIssue:288`,
  `assigneeLabel:283` passed inline) and `-project-procurement-tab.tsx`
  (`toggleTag:101`, inline `onChange` closures `:152-173`).
- **Description:** `ProjectIssuesTab`/`ProjectProcurementTab` are large
  components (29.8K / 25.8K) that re-render fully whenever any of their many
  queries settle (5 issue queries in F2). Child props like `onToggle={toggleTag}`
  and per-row `onClick` closures are recreated every render; `ProjectTagFilter`
  and each row therefore re-render even when their data is unchanged. `memberLabels`
  is correctly `useMemo`'d (`:270`), so the gap is the callbacks/children, not the
  derived maps.
- **Impact:** Extra reconciliation on every query settle; minor at current list
  sizes (single page, ≤100 rows) but compounds with F2's 5× refetch cadence.
- **Recommended fix (not applied):** `useCallback` the stable handlers
  (`toggleTag`, `openIssue`, `openProcurement`) and, if profiling warrants,
  `React.memo` the row component keyed by issue/procurement id so unrelated
  query settles don't re-render every row.

---

## Areas checked and found clean

- **Procurement `listByProject`** (`procurement.service.ts:410-468`): correct
  `innerJoin` of `items`+`procurementDetails`, single `projectShortId` resolution
  (`:452`), and batched `loadResourceTagsByResource` (`:465`). This is the
  reference pattern F1/F3/F5 should adopt — no N+1.
- **`loadResourceTagsByResource` resource grouping** (`tag.service.ts:227-252`):
  one `inArray(resourceId)` query for the whole page; `tags_refs` PK leads with
  `resource_id` so the lookup is index-covered. (Only the per-row `usageCount`
  subquery is the issue — F7.)
- **`relation_tuples` assignee lookup** (`getAssigneeId`,
  `issue.service.ts:75-86`): filter `(namespace, objectId, relation,
  subjectNamespace)` is covered by `idx_tuples_object(namespace,objectId,relation)`
  — indexed (the problem is call frequency, F1, not the index).
- **`getMemberCapabilities`** (`project.service.ts:653-662`): single
  `innerJoin` of members+roles filtered on the composite unique index — no N+1.
- **`items` indexing** (`item/schema.ts`): `idx_items_type_status_deleted`,
  `idx_items_type_deleted`, `idx_items_pinned` cover the list/pin access paths.
- **`useProjectCapabilities`** (`-use-project-role.ts:67-70`): properly memoized
  on `[capabilities, isAppAdmin]`.
- **Duplicate `useProject`/`useProjectMembers`/`useVisibleUsers` across the
  layout and tab routes** (`$projectId.lazy.tsx:44-46`,
  `$projectId.issues.lazy.tsx:20-22`): same query keys → TanStack Query dedupes,
  so these are cache hits, not extra network calls.
