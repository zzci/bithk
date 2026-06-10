# FEAT-026 - HR approvals sub-module

- Status: Completed
- Plan: [PLAN-078](../plan/PLAN-078.md)
- Campaign: local
- Owner: session
- Created: 2026-06-10

## Summary

Implement the Approvals tab under HR: admin-managed approval requests
(leave / overtime / business trip / other) filed for a colleague, with a
pending → approved/rejected decision flow. Decided records are immutable.

## Acceptance Criteria

- `hr_approvals` table created via Drizzle-generated migration; FK to
  `hr_colleagues` (RESTRICT) and `users.decided_by` (SET NULL).
- Admin-only routes: list (status/type/q filters + pagination), create,
  update (pending-only), decision (pending-only, stamps decider and time),
  delete (pending-only); decided records return 409 on mutation.
- Applicant must be an existing active colleague (404 missing, 400
  archived).
- Web Approvals page replaces the placeholder: list with status/type
  filters, create/edit dialog with colleague picker, approve/reject dialog
  with optional note; en/zh i18n.
- Backup contribution covers the new table.
- Focused API route tests and frontend tests; `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/hr/**`, `apps/api/drizzle/**` (generated)
- `apps/web/src/shared/lib/api/hr-approvals*.ts`
- `apps/web/src/app/routes/_app/hr/approvals/**`
- `apps/web/src/locales/{en,zh}/hr.json`
- `docs/modules/hr.md`, `docs/reference/**`, `docs/changelog.md`

## Dependencies

- [FEAT-025](FEAT-025.md) (HR module rename + placeholder tabs).

## Status Notes

- 2026-06-10: Created with [PLAN-078](../plan/PLAN-078.md); implementation
  started (user confirmed admin-only).
- 2026-06-10: Completed. `hr_approvals` table (migration 0003), services with
  pending-only mutation invariants and one-way decision flow, admin-only
  routes mounted from `hrRoutes()`, backup contribution extended, Approvals
  page (filters, create/edit, approve/reject dialog with note, withdraw),
  en/zh i18n, 14 API route tests + data-layer/page tests. `bun run check`
  EXIT 0.
