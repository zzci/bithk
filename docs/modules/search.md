# Search Module

Global cross-module search. A single read-only endpoint queries documents,
issues, projects, and drive entries scoped to the caller's permissions, for
the sidebar search box / command palette. The module **owns no tables** — it
fans out to other modules' list/search functions and merges the hits.

## File layout

```text
apps/api/src/modules/search/
  search.routes.ts   # GET /api/search
  search.service.ts  # globalSearch — fan-out + merge
  index.ts           # route export
  search.test.ts
```

## Database

None. Search reads through other modules; it persists nothing.

## Routes

Mounted under `protectedRoutes`; `authRequired`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/search` | Global search. Query: `q` (search text; empty ⇒ empty result), `limit` (per-bucket cap, default 8, clamped to 1–20). Returns `{ documents, issues, projects, drive, ships }`, each a list of hits. |

A hit is `{ type, id, title, subtitle?, projectId? }`:

- `type` ∈ `{document, issue, project, drive, ship}`.
- `id` is the `short_id` for document / issue / project, or the entry id for drive.
- `subtitle` carries the issue status or the project code where applicable.
- `projectId` is the owning project `short_id` for issue hits.

## Behavior

`globalSearch` calls, per bucket:

- **documents** — `listMyDocuments` (title match).
- **issues** — `searchIssues` (title / description), tagged with status + owning project.
- **projects** — `listProjects` (name match), tagged with the project code.
- **ships** — `listShips` (name match), tagged with the ship code.
- **drive** — `searchDriveEntriesByOwners` over the caller's resolvable owners:
  their personal drive, every team directory they belong to, and every project
  they are a member of.

Before fanning out, the route resolves the actor's visible modules
(PLAN-076 global roles) and skips buckets whose module is not granted —
`documents`, `drive`, `projects`, and `ships` map to their module keys;
`issues` belong to `projects`. Admins resolve to every module and so search
every bucket.

Within visible buckets there is no custom ranking: buckets are returned in
fixed order and each is independently capped at `limit`. **Permission
scoping is delegated** — each underlying list/search function enforces its
own access rules (admins see all projects; non-admins are restricted to
their memberships), so search adds no further checks of its own.

## Out of scope

- Full-text ranking / relevance scoring (results are LIKE-matched, fixed order).
- A dedicated FTS index — see the document module's FTS note.
- Searching audit, settings, or other admin-only stores.
