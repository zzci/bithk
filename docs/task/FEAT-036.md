# FEAT-036 HR colleague salary + one-click payroll generation + governance split

- Status: Completed
- Plan: [PLAN-086](../plan/PLAN-086.md)
- Owner: local-session
- Updated: 2026-06-16

## Goal

Let an admin seed a month's payroll from each colleague's standing salary in
one idempotent call, summarise payroll net per currency, and split governance
(decisions, marking paid) from ordinary field edits — governance admin-only,
edits module-gated.

## Scope

### Schema + migration

- `hr_colleagues` gains `salary_amount` (`integer`, minor units, nullable) and
  `salary_currency` (`text`, 3-letter code, nullable).
- Drizzle migration `0002_dazzling_raza.sql` (+ snapshot).

### Payroll service (`hr.payroll.service.ts`)

- `generatePayrollForPeriod(db, period)`: candidates are **active** colleagues
  with both `salary_amount` and `salary_currency` set; for each that has no
  record for the `YYYY-MM` period, insert a `pending` record with
  `base = net = salary_amount`, `bonus = 0`, `deduction = 0`. Idempotent
  (already-present colleagues are skipped), returns `{ created, skipped }`,
  never marks anything paid.
- `listPayrollRecords` returns `totals` = `[{ currency, net }]` summed over the
  **entire filtered set** (separate grouped query, not just the page).

### Routes

- `POST /api/hr/payroll/generate` — admin-only (`adminRequired`); body
  `{ period: "YYYY-MM" }`; returns `{ created, skipped }`.
- `GET /api/hr/payroll` — `meta.totals` carries the per-currency net summary.
- `PATCH /api/hr/payroll/:id` with `status:"paid"` — admin-only (explicit
  `user.role === "admin"` check → 403 otherwise); plain field edits stay
  module-gated.
- `POST /api/hr/approvals/:id/decision` — admin-only (`adminRequired`).
- `GET /api/hr/approvals` — list ordered newest-first
  (`createdAt desc, id desc`).

## Acceptance

- Generation inserts one pending record per eligible colleague with no period
  record; a re-run inserts nothing (`skipped` only); never marks paid.
- `meta.totals` reflects the whole filtered set across pages.
- Non-admins cannot decide approvals, mark payroll paid, or generate payroll
  (403); they retain read + non-governance edits under the `hr` module gate.
- All existing route tests pass; `bun run check` EXIT 0.

## Notes

- 2026-06-16 — Completed. Amounts remain integers in the currency's minor unit;
  net stays simple arithmetic (no currency conversion). Currency is validated
  by format (`/^[A-Z]{3}$/`), not an enum, so new currencies need no schema
  change.
