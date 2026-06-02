# REFACTOR-017 Add SearchCreateBar (search left + create right)

- **status**: in_progress
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-06-02 06:20

## Description

Add `shared/components/search-create-bar.tsx`: a minimal toolbar for lists with
no chip filters — a full-width search box on the left and a create button on the
right (e.g. the contacts list). Composes the shared `SearchInput`. Distinct from
`ListToolbar` (REFACTOR-016), which carries a left filters slot and a fixed-width
search.

Acceptance: search fills available width, create sits on the right and is gated by
permission; page-reset behaviour preserved; existing tests + `bun run check` green.

## ActiveForm

Adding a search-left + create-right toolbar component.

## Dependencies

- **blocked by**: (none — SearchInput already exists)
- **blocks**: (none)

## Notes

- 2026-06-02: `shared/components/search-create-bar.tsx` created (typecheck + lint
  pass). Consumer migration deferred — see PLAN-051 Migration Guide §8.