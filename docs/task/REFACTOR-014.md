# REFACTOR-014 ResponsiveTableList for contacts + procurements (optional)

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-06-02 05:42

## Description

Optional Phase 3. Extract a `ResponsiveTableList` covering the ~95% shared
responsive-grid table used by `contacts/index.lazy.tsx` and
`-project-procurement-tab.tsx` (header row, data rows, row action menu, grid
template, pagination via REFACTOR-012 primitives).

Only proceed if Phase 1–2 land cleanly AND the abstraction stays simple. If it
starts needing many flags (masked confidential fields, pin toggle, status/amount
cells), stop and keep the per-module lists.

Acceptance: both lists behave identically (search, filters, row actions, detail
open, masking, pagination); existing tests + `bun run check` green.

## ActiveForm

Extracting a shared responsive table list for contacts and procurements.

## Dependencies

- **blocked by**: REFACTOR-012
- **blocks**: (none)

## Notes

Gate decision: confirm with the user before starting — may be dropped if Phase 1–2
already deliver the bulk of the value.
