# REFACTOR-011 Merge project/ship cover fields into a shared CoverField

- **status**: in_progress
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-06-02 05:42

## Description

`projects/-project-cover-field.tsx` and `ships/-ship-cover-field.tsx` are ~95%
identical. Create `shared/components/cover-field.tsx` parameterised by
`{ kind, currentUrl, onPick, onRemove, showToast }`, delete both copies, and
update the consumers (`ProjectSettingsGeneral`, `ShipOverviewTab`).

Acceptance: project keeps its success/error toast (showToast=true), ship keeps no
toast; upload/replace/remove all work; `cover-image.tsx` display unchanged;
existing tests + `bun run check` green.

## ActiveForm

Merging the project and ship cover fields into one shared component.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-06-02: `shared/components/cover-field.tsx` created (presentational; caller
  owns mutations + toast). Typecheck + lint pass. Consumer migration deferred —
  see PLAN-051 Migration Guide §2. CoverKind re-declared locally to avoid editing
  cover-image.tsx.
