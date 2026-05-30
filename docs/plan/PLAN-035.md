# PLAN-035 Procurement detail parity with issue details

- **status**: Completed
- **owner**: l1-lsqiuvv9 / L2 zrk82evn
- **campaignId**: l1-lsqiuvv9-20260528233234
- **task**: [FEAT-016](../task/FEAT-016.md)
- **createdAt**: 2026-05-28

## Goal

Give procurement rows a detail experience that reuses the project issue detail
interaction model (`-project-issue-panel.tsx`), referencing the
`/app/zzci/access` portal issue detail behavior. Procurement gains the
issue-like fields it currently lacks (description, priority, dueDate) while
keeping its procurement-specific fields (itemName, supplier, category, quantity,
amount, currency).

User request: procurement needs a reusable detail experience aligned with the issues detail page, including additional fields and the interaction behavior from the access issues details.

## Investigation

### Current procurement (BITHK)

- Frontend: `apps/web/src/app/routes/_app/projects/-project-procurement-tab.tsx`
  is a table/list with create dialog, status/category filters, pipeline cards,
  pin, per-row status change, delete. Rows are **not** openable today.
- Frontend API: `apps/web/src/shared/lib/api/procurement.ts` - list/create/
  update/delete/status/pin hooks. `useUpdateProcurement` already exists. No
  single-row read hook.
- Backend routes: `apps/api/src/modules/procurement/procurement.routes.ts` -
  GET/PATCH detail endpoints already exist, plus comments/attachments via
  `mountItemCommentRoutes`. `createSchema`/`updateSchema` lack description,
  priority, dueDate.
- Backend service: `apps/api/src/modules/procurement/procurement.service.ts` -
  `composeProcurement`, create/update. `ProcurementRow` lacks the three fields.
- Backend schema: `apps/api/src/modules/procurement/schema.ts` -
  `procurement_details` has supplier/category/assignee/itemName/quantity/amount/
  currency. Missing description, priority, dueDate.

### Reference: issue detail (the parity target)

- `-project-issue-panel.tsx` is the existing BITHK zen-mode detail panel
  (drawer + fullscreen variants): inline title/description editing
  (MarkdownEditor), status + priority + dueDate + assignee controls, attachment
  upload, comments/activity footer (`ResourceFooterSections`), delete,
  Escape/close + maximize behavior, loading/error states.
- Drawer route: `$projectId.issues.$issueId.lazy.tsx` (nested Sheet overlay).
- Fullscreen route: `$projectId_.issues.$issueId.full.lazy.tsx` (deep link).
- `-project-issue-hooks.ts` exposes `useProjectIssue` / `useUpdateProjectIssue`
  / `useDeleteProjectIssue` keyed under `projectKeys`.
- `/app/zzci/access` `-issue-panel.tsx` is the original behavior reference
  (same interaction model). BITHK already mirrors it for issues.

### Issue field storage (model to copy)

`issue_details` stores `description`, `priority` (enum low/medium/high/urgent,
default medium), `dueDate` on the sub-type table. Procurement should mirror this
exactly on `procurement_details`.

### Migration coordination

`createDb` runs `drizzle-orm/bun-sqlite` `migrate()` from `apps/api/drizzle/`,
so adding columns REQUIRES a generated migration (tests fail otherwise).
Migrations must be produced by `drizzle-kit generate` (never hand-written) and
coordinated with CHORE-002 / PLAN-030 baseline rebuild to avoid clobbering its
work. Dev stage accepts breaking DB changes.

## Proposal

Two subtasks, serial (frontend depends on the backend contract):

### Subtask B - Backend procurement field parity (worktree)

Files: `apps/api/src/modules/procurement/{schema,procurement.service,
procurement.routes,procurement.service.test,procurement.routes.test}.ts`,
`apps/api/drizzle/*` (generated), `apps/api/src/db/embedded-migrations.ts`.

- Add `description text`, `priority text enum default 'medium'`, `dueDate text`
  to `procurement_details` (mirror `issue_details`).
- Extend `ProcurementRow`, `CreateProcurementInput`, `UpdateProcurementInput`,
  `composeProcurement`, create/update in the service.
- Extend `createSchema`/`updateSchema` zod with description (nullable),
  priority (enum), dueDate (nullable) using the same validation as issues.
- Regenerate the migration via `drizzle-kit generate`; refresh embedded
  migrations if the generation flow requires it.
- Update/extend backend tests to cover the new fields on create/update/detail/
  list.

### Subtask F - Frontend procurement detail experience (worktree, deps=[B])

Files: `apps/web/src/shared/lib/api/procurement.{ts,test.ts}`, new
`-project-procurement-panel.tsx`, new procurement drawer + fullscreen lazy/route
stubs, `-project-procurement-tab.tsx` (open rows + create dialog fields),
`apps/web/src/locales/{en,zh}/projects.json`, docs.

- API: add description/priority/dueDate to `ProcurementRow`,
  `CreateProcurementInput`, `UpdateProcurementInput`; add a single-procurement
  read hook (`useProcurement`) mirroring `useProjectIssue`.
- Panel: `-project-procurement-panel.tsx` modeled on `-project-issue-panel.tsx`
  - inline title (itemName)/description editing, status (procurement pipeline
  statuses), priority, dueDate, assignee, supplier, category, quantity, amount,
  currency, attachment upload, comments footer
  (`resource=projects/$id/procurements`), delete, Escape/maximize/close.
  Permissions follow procurement.manage (admins bypass), matching the tab.
- Routes: drawer `$projectId.procurements.$procurementId` (Sheet overlay) and
  fullscreen `$projectId_.procurements.$procurementId.full` mirroring the issue
  routes; rows in the tab open the drawer.
- Create dialog: add priority/dueDate/description inputs.
- Locales: add procurement detail/field keys (en + zh). Watch for sibling
  locale collisions at merge.
- Tests: extend `procurement.test.ts`; add a panel test.

## Acceptance Criteria

- Procurement rows open into a drawer detail surface plus a fullscreen/deep-link
  route, mirroring the issue interaction model.
- Detail surface reuses issue behavior: inline title/description, status,
  priority, dueDate, assignee, delete, attachment upload, comments/activity
  footer, loading/error states, Escape/close, maximize.
- New fields description/priority/dueDate added while preserving itemName,
  supplier, category, quantity, amount, currency.
- Backend create/update/detail/list expose the new fields with issue-comparable
  validation.
- Comments/attachments keep working via the existing item routes.
- Existing list behavior intact: filters, pipeline cards, pin/unpin, create,
  delete, permissions, project scoping.
- Focused backend + frontend tests added; English docs/locales updated;
  `bun run check` run if feasible.

## Scope Update (2026-05-28, L1)

Two requirements added to the same campaign (no new L2):

1. **Add a `cancelled` procurement status.** Use the `cancelled` spelling
   (matches issue status convention). Backend: append to `PROCUREMENT_STATUSES`
   (schema.ts) so create/update/status/list/detail validation pick it up;
   `changeStatus`/`isProcurementStatus` accept it. Frontend: status filter,
   pipeline cards, per-row status select, detail status control, locales
   (en+zh), and tests include `cancelled`.
2. **Procurement is not deletable.** This overrides the issue-detail parity
   assumption that the detail surface exposes delete. Backend: remove the
   `DELETE /projects/:projectId/procurements/:id` route (and dead
   `softDeleteProcurement` if only that route used it - grep first); tests
   assert deletion is unavailable (404) and the row persists. Frontend: remove
   the tab per-row Delete button + ConfirmDeleteDialog, do not port delete into
   the new panel, remove the `useDeleteProcurement` hook (grep first). Pin,
   comments, attachments, status change, create, edit, scoping, permissions
   stay intact.

Amended in place: backend reqs folded into subtask B (7e0xb6a5, already
working, owns those files); frontend reqs folded into subtask F (urtxma4j,
queued). No parallel L3 spawned - files do not overlap across B/F.

## Out of Scope

- Turning issues into a procurement subtype or a broad domain merge.
- Reworking the issues list UI (owned by L2 jx6r32gn).
- Tag abstraction, role settings, project code placement.
- Hand-authored migrations (use drizzle-kit; coordinate with CHORE-002).
