# REFACTOR-010 Extract shared detail-panel skeleton (issue + procurement)

- **status**: in_progress
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-06-02 05:42

## Description

Extract the ~72% shared structure of `-project-issue-panel.tsx` and
`-project-procurement-panel.tsx` into reusable pieces, keeping each panel's
domain-specific slots. Done in sub-steps, smallest/lowest-risk first.

### Step A — DetailPanelHeader (do first)

New `shared/components/detail-panel-header.tsx`. The header block at
`-project-issue-panel.tsx:272-356` is byte-identical to the procurement panel's
header. It is self-contained drawer chrome: back (fullscreen) / inline-editable
title / delete / maximize / close.

Proposed API:

```tsx
interface DetailPanelHeaderProps {
  variant: "drawer" | "fullscreen";
  title: string;
  titleEdit?: { canEdit: boolean; onSave: (next: string) => void; placeholder?: string };
  backLabel?: string;
  onClose: () => void;
  onMaximize?: () => void;   // only shown when provided (drawer)
  onDelete?: () => void;     // only shown when provided (issue has it, procurement does not)
}
```

- Inline title editing state (`editingTitle`/`titleDraft`, Enter/blur to save,
  Escape to revert) is owned **inside** the component; callers only pass `onSave`.
  Omitting `titleEdit` makes the title read-only.
- `onDelete?` controls the delete button visibility; the delete **confirm dialog**
  stays in the issue panel (domain logic) — header only triggers it.

### Step B — shared skeleton + editor hook

- New: `app/routes/_app/projects/-detail-panel.tsx` (uses DetailPanelHeader +
  meta row, tags row, description region, creator footer, `ResourceFooterSections`).
- New: `app/routes/_app/projects/-use-detail-panel-editor.ts` (description draft
  state, save handlers, panel-level Escape handling).
- Issue panel keeps: delete confirm dialog (slot).
- Procurement panel keeps: detail table (supplier/category/qty/amount/currency)
  + `InlineValue`/`ProcurementDetailRow` (slot).
- Permission decisions stay in the callers (issue has isCreator/isAssignee that
  procurement lacks).

Acceptance: behaviour unchanged for both drawer and fullscreen variants; existing
panel tests pass; `bun run check` green; net duplication reduced (~460 lines).
Step A is independently shippable and may land before Step B.

## ActiveForm

Extracting the shared issue/procurement detail-panel skeleton.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-06-02: Step A component `shared/components/detail-panel-header.tsx` created
  (typecheck + lint pass). Consumer migration (issue/procurement panels) deferred —
  see PLAN-051 Migration Guide §1. Step B (skeleton + editor hook) not started.
