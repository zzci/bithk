# REFACTOR-016 Unify list toolbar (filters slot + search + create)

- **status**: in_progress
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-06-02 06:05

## Description

Extract `shared/components/list-toolbar.tsx`: a toolbar shell with a left-side
`filters` slot and a unified right-side search box + create button (composes the
shared `SearchInput`). Standardizes the project / ship / work-order toolbars.

Decision (2026-06-02, user-approved):

- The create button moves to the right of the search box on every list. Projects
  and ships currently render create on the title row — that button relocates into
  the toolbar.
- Left-side filter controls (status chips, tag filter, type select) stay per-list
  via the slot; not unified.

Acceptance: projects/ships/issues toolbars render filters + search + create in one
row; create gated by the same permission as before; search page-reset behaviour
preserved; existing tests + `bun run check` green.

## ActiveForm

Unifying the list toolbar into a filters-slot + search + create shell.

## Dependencies

- **blocked by**: (none — SearchInput already exists)
- **blocks**: (none)

## Notes

- 2026-06-02: `shared/components/list-toolbar.tsx` created (typecheck + lint pass).
  Consumer migration deferred — see PLAN-051 Migration Guide §7. Index row for this
  task pending resolution of the in-progress `bkd/xgbm1bkf` merge on main (docs
  index files currently conflicted).