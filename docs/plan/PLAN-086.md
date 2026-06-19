# PLAN-086 HR approvals/payroll completeness + colleague-salary auto-pay

- status: Completed
- createdAt: 2026-06-16 15:01
- approvedAt: 2026-06-16 15:01
- relatedTask: FEAT-036, UI-026

## Context

The HR module shipped Colleagues, Approvals, and Payroll (PLAN-077, PLAN-078,
PLAN-079) but the approvals and payroll surfaces were thin: there was no way to
seed a month's payroll from each colleague's standing salary, no per-currency
totals, no decision/payroll governance split from plain field edits, and the
approvals list lacked timing columns and a full detail view. This round closes
those gaps so an admin can run a month's payroll in one click and read totals
at a glance, while non-admins keep read access without governance powers.

## Goal

- Store a standing monthly salary on a colleague and let an admin generate a
  full period's pending payroll from it in one click, idempotently.
- Summarise payroll net per currency over the whole filtered set, not just the
  current page.
- Split governance (deciding an approval, marking a payroll record paid) from
  ordinary field edits: governance is admin-only, edits stay module-gated.
- Make the approvals list newest-first with timing columns and a full
  reason/decision-note detail view.

## Proposal

Implemented as parallel BKD lanes (file-disjoint), folded by L2:

- **A — schema + migration.** `hr_colleagues` gains `salary_amount` (integer
  minor units, nullable) and `salary_currency` (3-letter code, nullable);
  Drizzle migration `0002_dazzling_raza.sql`.
- **B — payroll service.** `generatePayrollForPeriod(db, period)` inserts a
  pending record (base = net = salary, bonus = deduction = 0) for each active
  colleague that has a salary set and no record for the `YYYY-MM` period;
  idempotent, returns `{ created, skipped }`, never marks paid. `listPayrollRecords`
  computes `totals` = net per currency over the entire filtered set.
- **C — payroll routes.** `POST /hr/payroll/generate` (admin-only); `meta.totals`
  surfaced on the list; `PATCH /hr/payroll/:id` with `status:"paid"` gated to
  admins (plain field edits stay module-gated).
- **D — approvals routes + service.** `POST /hr/approvals/:id/decision` stays
  admin-only; list ordered newest-first (`createdAt desc, id desc`).
- **E — colleague form.** A Salary section (standard monthly salary + currency)
  on the colleague panel; blank amount/currency persist as `null`.
- **F — approvals page.** Submitted-at / decided-at columns, full reason +
  decision-note detail view, Textarea inputs; approve/reject hidden for non-admins.
- **G — payroll page.** Colleague filter, paid-at column, per-currency net
  summary, thousands-separated money via a new `formatMoney` helper, Textarea
  notes, an admin-only "generate this month's payroll" one-click button; mark-paid and generate
  hidden for non-admins.
- **H — i18n.** `en/zh` `hr.json` extended for the salary fields, the columns,
  the detail view, the totals summary, and the generate action.
- **I — docs.** This plan, FEAT-036, UI-026, the index rows, `modules/hr.md`,
  and the changelog (this lane).

## Risks

- Generation must never duplicate or mark paid. Mitigation: the candidate query
  excludes colleagues that already hold a record for the period and rows are
  always inserted as `pending`; a re-run inserts nothing (`skipped` only).
- Admin short-circuit must not leak governance to module-gated non-admins.
  Mitigation: `adminRequired` on `/decision` and `/generate`; the `status:"paid"`
  branch on PATCH checks `user.role === "admin"` explicitly and throws 403.
- Nullable salary columns flow into a non-null insert. Mitigation: the query
  filter excludes unset salaries; the loop keeps a type-narrowing backstop.

## Scope

- `apps/api/src/modules/hr/{schema.ts,hr.payroll.service.ts,hr.payroll.routes.ts,hr.approvals.routes.ts,hr.approvals.service.ts}`,
  `apps/api/drizzle/0002_dazzling_raza.sql`.
- `apps/web/src/app/routes/_app/hr/{-colleague-form-logic.ts,-colleague-panel.tsx,-approvals-page.tsx,-payroll-page.tsx}`,
  `apps/web/src/shared/lib/format.ts`, `apps/web/src/shared/lib/api/{hr.ts,hr-payroll.ts}`,
  `apps/web/src/locales/{en,zh}/hr.json`.
- Out: employee self-service, multi-step approval chains, currency conversion,
  payroll calculation rules (amounts stay manually entered; net is arithmetic).

## Alternatives

- A writable `status` field on the payroll PATCH for marking paid — rejected:
  deciding/marking-paid are one-way governance actions, kept explicit (decision
  endpoint; admin-checked PATCH branch) so they cannot be confused with edits.
- Per-page totals — rejected: a summary must reflect the whole filtered set, so
  totals are a separate grouped query independent of pagination.

## Annotations

- 2026-06-16 — Completed. `bun run check` EXIT 0. Numbering note: the brief
  named PLAN-079 but that file already exists (HR colleague detail drawer) and
  is unrelated; this plan uses the next free number PLAN-086, with FEAT-036
  (backend) and UI-026 (frontend).
