# Decision: Issue tag-filter uses OR (union) semantics

- Date: 2026-05-30
- Status: Accepted
- Sunset review: 2026-11-30
- Scope: `apps/api` issue list — `GET /projects/:projectId/issues?tagIds=...`

## Context

The issue list now accepts a multi-select `tagIds` filter scoped to the global
tag vocabulary `source_type='issue'`. A decision was required on how multiple
selected tags combine. The existing project tag filter is single-select, so
there is no AND/OR precedent in the codebase to follow.

## Decision

Multiple `tagIds` combine with **OR / UNION**: an issue matches if it carries
**any** of the selected tags. Implemented via `listResourceIdsByAnyTag` plus
`inArray(items.id, ids)` in `listByProject`
(`apps/api/src/modules/issue/issue.service.ts`).

`tagIds` accepts both repeated query params (`?tagIds=a&tagIds=b`) and
comma-separated values (`?tagIds=a,b`); each value resolves by tag id or name.
The parsed set is de-duplicated and capped (50) because it is untrusted input.

## Consequences

- Broadening the selection broadens the result set — the intuitive behavior for
  multi-select tag chips.
- AND ("must carry all selected tags") is intentionally **not** implemented.
- An empty / omitted `tagIds` applies no tag filter.

## Sunset

Revisit by **2026-11-30**. If users expect AND semantics, add an explicit
`tagMatch=all|any` switch (defaulting to `any`) rather than silently changing
the default behavior documented here.
