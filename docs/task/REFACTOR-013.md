# REFACTOR-013 Consolidate tag utilities + reuse TagsInput in contact form

- **status**: in_progress
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-06-02 05:42

## Description

- Move duplicated `addTag` / `removeTag` (in `projects/-project-form-logic.ts`
  and `contacts/-contact-form-logic.ts`) to `shared/lib/tag-utils.ts`; point both
  form-logic files and `projects/-tags-input.tsx` at the shared utils.
- Replace the contact form's hand-rolled chip/Enter/Backspace tag editor with
  `<TagsInput>` (currently only referenced by tests).

Acceptance: tag add/remove/dedup behaviour unchanged in both project and contact
forms; existing tests + `bun run check` green.

## ActiveForm

Consolidating tag utilities and reusing TagsInput in the contact form.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-06-02: `shared/lib/tag-utils.ts` created (addTag/removeTag). Typecheck +
  lint pass. Migrating form-logic files + TagsInput + contact form deferred — see
  PLAN-051 Migration Guide §6.
