# REFACTOR-012 Extract shared list primitives (pagination, toolbar filter, search)

- **status**: in_progress
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-06-02 05:42

## Description

Extract the near-verbatim list building blocks into `shared/components`:

- `pagination-footer.tsx` — prev/next + total (5 current sites: projects, ships,
  contacts, procurements).
- `toolbar-filter.tsx` — dropdown radio-group filter (procurements, contacts).
- `debounced-search-input.tsx` (or standardise consumers on the existing
  `useDebounce` hook).

Wire into the projects / ships / contacts / procurements lists. Issues list uses
client-side search and is out of scope here.

Acceptance: list behaviour unchanged (paging, filtering, debounce timing);
existing list tests + `bun run check` green.

## ActiveForm

Extracting shared pagination, toolbar-filter, and search list primitives.

## Dependencies

- **blocked by**: (none)
- **blocks**: REFACTOR-014

## Notes

- 2026-06-02: Created `pagination-footer.tsx`, `toolbar-filter.tsx`, and
  `search-input.tsx` (controlled; consumers keep the existing `useDebounce`).
  Typecheck + lint pass. Consumer migration deferred — see PLAN-051 Migration
  Guide §3–§5.
