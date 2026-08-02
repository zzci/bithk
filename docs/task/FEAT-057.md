# FEAT-057 - Payroll history section on the HR colleague detail panel

- Status: Planned
- Plan: [PLAN-107](../plan/PLAN-107.md)
- Created: 2026-08-02

## Goal

The colleague drawer shows the configured monthly salary but nothing about
what was actually paid, so answering "what has this person been paid?" means
leaving for the payroll tab and filtering by hand. Render that colleague's
payroll records inside the detail panel.

## Scope

Web only — `GET /hr/payroll?colleagueId=...` already exists and sits behind
the same module gate as the drawer, so no new endpoint and no new exposure.

- New `-colleague-payroll-section.tsx`: `useHrPayrollRecords({ colleagueId,
  limit: 12 })` rendered as a `PanelSection` in `ColleaguePanelView` between
  the payment and documents sections.
- Compact table: period, base / bonus / deduction, net, status badge, paid-at.
- Per-currency net total from `meta.totals` (server-computed over the full
  filtered set) and a total-count line when more records exist than are shown.
- Loading / empty / error states consistent with the rest of the panel.
- `locales/{en,zh}/hr.json`: section title; reuse existing `payroll.*` labels.

Out of scope: editing or marking paid from the drawer (stays on the payroll
tab), payslip export, deep link into a pre-filtered payroll tab.

## Verification

- Web test: rows render, totals render, empty state, no request while the
  panel is in create mode.
- `bun run check` EXIT 0.
