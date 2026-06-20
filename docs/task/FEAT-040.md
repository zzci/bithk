# FEAT-040 - Procurement drawer form for item details with confirm-lock

- Status: Completed
- Plan: [PLAN-092](../plan/PLAN-092.md)
- Campaign: local
- Owner: session
- Created: 2026-06-19

## Summary

Unify procurement create/edit into the shared `ResizableDrawer` form pattern
(the same global drawer used by colleagues/contacts), and add a business rule:
once a procurement is **confirmed** (status reaches `confirmed`), its item-detail
fields can no longer be modified; before confirmation they can.

The procurement detail panel keeps the issue-style inline click-to-edit for the
workflow fields (status, priority, assignee, due date, tags, description), but
moves the **item details** (品名/标题/供应商/类别/数量/金额/币种) out of inline
editing into an explicit edit-mode form. Create stops using the modal `Dialog`
and opens the same form inside the drawer.

## Acceptance Criteria

- **Lock rule (backend + frontend).** Item-detail fields
  `{ itemName, title, supplierId, categoryId, quantity, amount, currency }` are
  editable only while status is `requested` or `ordered`; for
  `confirmed | in_transit | received | accepted | cancelled` they are locked.
  - Backend: `PATCH /projects/:projectId/procurements/:id` rejects with
    `AppError(409, "PROCUREMENT_DETAILS_LOCKED")` when the row is locked and the
    body touches any locked field. Workflow fields
    (`description/priority/dueDate/tags/assigneeMemberId`) remain patchable in any
    status. Status transitions stay unrestricted (existing free-transition tests
    unchanged).
  - Frontend: the "edit details" affordance is hidden when locked.
- **Unified drawer form.** The procurement detail panel gains a `view | edit`
  mode. View shows item details read-only + an "edit details" button (hidden when
  locked) and keeps inline click-to-edit for status/priority/assignee/dueDate/
  tags/description. Edit is a real `<form>` (Save/Cancel) editing only the
  item-detail fields, calling PATCH.
- **Create in the drawer.** The modal `CreateProcurementDialog` is removed; the
  list "create" button opens a `ResizableDrawer` hosting the same form (create
  mode, full field set incl. initial status/description), mirroring the
  colleague/contact state-driven create.
- **Fullscreen page retained.** `…/procurements/$id/full` still works and gains
  the same view/edit capability.
- en/zh i18n for the new edit-mode strings and the locked hint.
- Focused tests: backend 409-after-confirmed (routes + service), updated
  procurement tab/panel web tests; `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/procurement/procurement.routes.ts`,
  `procurement.service.ts`, `schema.ts` (lock helper),
  `procurement.routes.test.ts`, `procurement.service.test.ts`
- `apps/web/src/shared/lib/api/procurement.ts` (lock helper, error surfacing)
- `apps/web/src/app/routes/_app/projects/-project-procurement-panel.tsx`
  (view/edit modes), `-project-procurement-form.tsx` (new shared form),
  `-project-procurement-tab.tsx` (drawer create, remove Dialog),
  `-project-procurement-panel.test.tsx`, `-project-procurement-tab.test.tsx`
- `apps/web/src/locales/{en,zh}/projects.json`
- `docs/changelog.md`

## Dependencies

- Builds on [FEAT-016](FEAT-016.md) / [PLAN-035](../plan/PLAN-035.md) (procurement
  detail parity) and reuses the shared `ResizableDrawer` pattern from
  [FEAT-030](FEAT-030.md). No DB migration (no schema change).

## Status Notes

- 2026-06-19: Created with [PLAN-092](../plan/PLAN-092.md); approved, implementation started.
- 2026-06-19: Completed. Backend: `schema.ts` lock helper
  (`isProcurementDetailLocked` + `PROCUREMENT_LOCKED_DETAIL_FIELDS`,
  editable only while `requested`/`ordered`); PATCH handler rejects locked-field
  edits with `409 PROCUREMENT_DETAILS_LOCKED` (workflow fields stay patchable);
  routes test covers the 409 + workflow-still-editable case. Web: new
  `-project-procurement-form{,-logic}.tsx` shared create/edit form; panel gains
  `view | edit` mode (item-detail table read-only + "edit details" button hidden
  when locked, inline workflow edits retained); tab create moved from modal
  `Dialog` to `ResizableDrawer`; `isProcurementDetailLocked` mirrored in the web
  api lib; en/zh i18n (editTitle/editDetails/detailsLockedHint, dropped orphan
  createDescription/clickToEditTitle). Tests: panel + tab updated (28 web pass),
  api 59 pass. Regenerated api-spec (409 response). `bun run check` EXIT 0. Not
  committed/pushed. Note: pre-existing unrelated dirty files (`apps/api/src/lode/*`,
  admin `-settings-about.tsx`, `settings.json`) left untouched.
