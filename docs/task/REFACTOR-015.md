# REFACTOR-015 CardGridList for projects + ships (optional)

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-06-02 05:42

## Description

Optional Phase 3. Extract a `CardGridList` covering the ~90% shared card-grid
shell used by `projects/index.lazy.tsx` and `ships/index.lazy.tsx` (toolbar with
status chips + search, responsive card grid, pagination, loading/empty/refetch
states) with a `renderCard` slot.

Filter chips differ (projects: tag filter; ships: vessel-type select) — keep
those in the caller. Only proceed if the abstraction stays simple; otherwise keep
the per-module lists.

Acceptance: both lists behave identically (filters, search, paging, card click,
states); existing tests + `bun run check` green.

## ActiveForm

Extracting a shared card-grid list for projects and ships.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Gate decision: confirm with the user before starting — may be dropped.
