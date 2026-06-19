# FEAT-037 Unify currency input/display to two decimals + global MoneyInput

- Status: Completed
- Plan: [PLAN-087](../plan/PLAN-087.md)
- Owner: local-session
- Updated: 2026-06-19

## Goal

Monetary amounts are stored as integers in a currency's minor unit (cents), but
the frontend never converted between minor units and the user-facing major-unit
value. Procurement amount inputs had no `step`, HR salary/payroll inputs used
`step={1}` plus an integer-only guard, so two-decimal amounts could not be
entered, and `formatMoney` displayed raw minor units with no fraction digits.

Make every currency field accept and display a two-decimal major-unit amount
(e.g. `1,234.56`) while storage stays minor-unit integer, and provide a reusable
`MoneyInput` component for currency input boxes.

## Scope

- `apps/web/src/shared/lib/format.ts`: `formatMoney` divides by 100 and renders
  exactly two fraction digits; add `parseMoneyToMinor` and `minorToInput`.
- `apps/web/src/shared/components/money-input.tsx`: new global currency input.
- Procurement create dialog + list display + detail inline edit.
- HR colleague salary field + form mapping.
- HR payroll create/edit dialog (base/bonus/deduction).
- Update affected web tests.

## Acceptance

- Entering `1234.56` in any currency field saves `123456` minor units and
  displays `1,234.56`.
- Quantity and currency-code fields are unchanged.
- `bun run check` exits 0.

## Notes

- Backend storage convention is already minor-unit integer (schema comments,
  seed `baseSalary: 850000`, tests `salaryAmount: 5000_00`); no schema or data
  migration. Fix is frontend-only.
- 2026-06-19 — Done. `bun run check` exits 0. Procurement seed amounts rescaled
  x100 to minor units (they had been entered as whole units); HR seed was
  already minor-unit. Affected web tests updated for the new major-unit input
  semantics and two-decimal display.
