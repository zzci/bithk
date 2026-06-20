# PLAN-092 Procurement drawer form for item details with confirm-lock

- **status**: completed
- **createdAt**: 2026-06-19 00:00
- **approvedAt**: 2026-06-19 00:00
- **relatedTask**: FEAT-040

## Context

Procurement currently has two inconsistent edit surfaces:

- **Create** = a modal `<Dialog>` (`CreateProcurementDialog` in
  `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx:332`).
- **Edit** = an inline click-to-edit detail panel
  (`-project-procurement-panel.tsx`) rendered inside the shared
  `ResizableDrawer` via the routed drawer
  `$projectId.procurements.$procurementId.lazy.tsx` (also reused at
  `variant="fullscreen"` on `…/$procurementId/full`). Every field commits
  immediately via PATCH — there is no edit mode or form.

The colleague/contact panels (`-colleague-panel.tsx`, `-contact-panel.tsx`) are
the established "global drawer" pattern: one `mode = create | view | edit` panel
inside `ResizableDrawer`, view read-only, create/edit a real `<form>` with a
Save/Cancel footer.

Backend: procurement is its own module `apps/api/src/modules/procurement/`.
`PATCH /projects/:projectId/procurements/:id` (`procurement.routes.ts:305`)
validates with `updateSchema` (no `status` field) and calls
`updateProcurement(db, id, body)` (`procurement.service.ts:281`), which loads the
row first (`loadByShortId`) so the current `status` is available. Status lives on
the shared `items` table and is changed only via `POST …/status`
(`changeStatus`). Status enum (`schema.ts:6`): `requested, ordered, confirmed,
in_transit, received, accepted, cancelled`. Existing "free transition" tests
assert status flow is unrestricted.

Established "immutable after state" precedent: HR payroll throws
`AppError("…", 409, "PAYROLL_PAID")` (`hr.payroll.service.ts:283`). `AppError`
serializes to `{ success: false, error: { code, message } }`.

## Proposal

### Business rule — confirm-lock on item details

Locked fields (item details): `itemName, title, supplierId, categoryId,
quantity, amount, currency`. Locked statuses: everything except `requested` /
`ordered` (i.e. `confirmed, in_transit, received, accepted, cancelled`).

- **Backend.** Add a shared helper in `procurement/schema.ts`:
  `PROCUREMENT_EDITABLE_STATUSES = ["requested","ordered"]` and
  `isProcurementDetailLocked(status)`. In the PATCH handler (after
  `requireProcurement` gives `procurement.status`), if locked **and** the
  validated body contains any locked key, throw
  `AppError("Procurement is confirmed; item details can no longer be modified",
  409, "PROCUREMENT_DETAILS_LOCKED")`. Workflow fields stay patchable in any
  status. Place the guard in the route handler (has `procurement.status` + the
  parsed body) to keep the service signature unchanged.

- **Frontend.** Mirror the helper in `shared/lib/api/procurement.ts`
  (`isProcurementDetailLocked`). The panel hides the "edit details" entry when
  locked; surface the 409 via the existing `errorMessage` path.

### Frontend — unified drawer form

- **New `-project-procurement-form.tsx`**: a presentational form component for
  the item-detail fields (品名/标题/供应商/类别/数量/金额/币种) plus, in
  `create` mode only, the workflow fields needed at creation (status, priority,
  due date, assignee, tags, description). `mode: "create" | "edit"`. Reuses the
  colleague layout primitives (PanelSection / labelled inputs / Select /
  MoneyInput / TagInput). Seeds from an existing row in edit mode.
- **`-project-procurement-panel.tsx`**: add internal `mode` state
  (`view | edit`). View keeps the inline meta row (status/priority/assignee/
  dueDate), tags, and description (issue-style), but renders the 采购细节 table
  **read-only** with an "编辑详情" button (hidden when `!canEdit` or locked).
  Edit renders the form; Save → `useUpdateProcurement` (item-detail keys only) →
  back to view; Cancel → back to view. Remove the header inline-rename of
  `itemName` (now form-edited) and the inline editors in the details table.
- **`-project-procurement-tab.tsx`**: delete `CreateProcurementDialog`; the
  create button opens a `ResizableDrawer` hosting the form in `create` mode
  (state-driven, like colleagues). On success: toast + close. No new route
  (create has no id to deep-link).
- Drawer/fullscreen routes unchanged structurally; the panel’s new mode works
  under both `variant="drawer"` and `variant="fullscreen"`.

### i18n / tests

- Add `projects.json` (en+zh): `procurement.detail.editDetails`,
  `procurement.detail.editTitle`, `procurement.detail.detailsLockedHint`, and any
  form labels not already present.
- Backend: 409-after-confirmed cases in `procurement.routes.test.ts`
  (PATCH locked field → 409; PATCH workflow field while confirmed → 200) and a
  `updateProcurement`-level guard is not needed (guard is in the route), so add
  the route-level tests; keep existing free-transition tests.
- Web: update `-project-procurement-tab.test.tsx` (create now in drawer) and
  `-project-procurement-panel.test.tsx` (view/edit modes, locked hidden).

## Risks

- Diverges procurement from the issue panel's inline-edit parity (item details
  only). Acceptable per the requested UX; description/meta parity retained.
- The 409 guard must be field-selective; a blanket "no PATCH when confirmed"
  would wrongly block status-independent workflow edits. Covered by tests.
- Web panel test churn (inline → mode-based). No DB migration; backend service
  signature unchanged.

## Scope

~2 backend files + 2 test files; 3 web component files (1 new) + 2 test files;
1 web api-lib file; 2 i18n files; changelog. No schema/migration.

## Alternatives

- **Routed `/procurements/new` create drawer** instead of state-driven — more
  consistent with the existing routed view/edit but adds route files and
  route-matching surface; rejected for surgical minimalism (create has no id).
- **Fully state-driven panel (drop routes + fullscreen)** like colleagues —
  rejected: user chose to keep the fullscreen page and deep-linkable drawer.

## Annotations

- 2026-06-19: User confirmed: (1) fully unify create/edit handling; (2) keep
  preview inline click-edit for workflow fields (status etc.), move item details
  to a form, description behaves like issues; (3) keep the fullscreen page. New
  rule: item details locked after confirmation. Session-decided defaults
  (approved implicitly by "开始处理"): create is state-driven (no new route);
  `cancelled` also locks item details.
