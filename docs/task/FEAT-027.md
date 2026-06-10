# FEAT-027 - HR payroll sub-module

- Status: Completed
- Plan: [PLAN-078](../plan/PLAN-078.md)
- Campaign: local
- Owner: session
- Created: 2026-06-10

## Summary

Implement the Payroll tab under HR: admin-managed per-colleague monthly
payroll records with multi-currency amounts (integer minor units), a
server-computed net amount, and a one-way pending → paid transition.

## Acceptance Criteria

- `hr_payroll_records` table created via Drizzle-generated migration; FK to
  `hr_colleagues` (RESTRICT); unique `(colleague_id, period)`.
- Multi-currency: `currency` is a 3-letter uppercase code validated by
  format (not an enum); the UI offers a curated code list.
- `net_amount` is computed server-side (base + bonus − deduction) and must
  be ≥ 0 (400 otherwise).
- Admin-only routes: list (period/colleague/status filters + pagination),
  create (duplicate period → 409), update (pending-only; `status: "paid"`
  stamps `paid_at`), delete (pending-only); paid records return 409 on
  mutation and cannot revert to pending.
- Web Payroll page replaces the placeholder: list with filters and
  amount + currency display, create/edit dialog, mark-paid action; en/zh
  i18n.
- Backup contribution covers the new table.
- Focused API route tests and frontend tests; `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/hr/**`, `apps/api/drizzle/**` (generated)
- `apps/web/src/shared/lib/api/hr-payroll*.ts`
- `apps/web/src/app/routes/_app/hr/payroll/**`
- `apps/web/src/locales/{en,zh}/hr.json`
- `docs/modules/hr.md`, `docs/reference/**`, `docs/changelog.md`

## Dependencies

- [FEAT-025](FEAT-025.md) (HR module rename + placeholder tabs).

## Status Notes

- 2026-06-10: Created with [PLAN-078](../plan/PLAN-078.md); implementation
  started (user confirmed multi-currency and admin-only).
- 2026-06-10: Completed. `hr_payroll_records` table (migration 0003) with
  unique `(colleague_id, period)`, multi-currency by format validation,
  server-computed non-negative net, one-way mark-paid; admin-only routes,
  backup contribution extended, Payroll page (period/status filters,
  create/edit with currency select, mark-paid, delete), en/zh i18n, 13 API
  route tests + data-layer/page tests. `bun run check` EXIT 0.
