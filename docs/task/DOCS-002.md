# DOCS-002 Global UI components reference

- **status**: completed
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-06-02 06:35

## Description

Author `docs/ui-components.md`: a reference catalog of the shared, cross-module
frontend components in `apps/web/src/shared/components/` plus shared utilities.
Covers conventions (shadcn base, presentational-first, i18n parity), per-component
prop tables and usage, adoption status, and a checklist for adding new shared
components.

## ActiveForm

Writing the global UI components reference doc.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-06-02: Created `docs/ui-components.md`. Documents ui/* primitives, the
  PLAN-051 component set (DetailPanelHeader, CoverField, PaginationFooter,
  ToolbarFilter, SearchInput, ListToolbar, SearchCreateBar, tag-utils) with their
  adoption status, plus existing shared components (ResizableDrawer,
  ResourceFooterSections, CoverImage, PrioritySignal). Includes the concurrently
  merged `ListFilter` (PLAN-054/FIX-033) as the preferred filter control and the
  usual occupant of ListToolbar's `filters` slot; notes ToolbarFilter is largely
  superseded by it.