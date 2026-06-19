# PLAN-087 Currency two-decimal formatting + global MoneyInput

- status: Completed
- createdAt: 2026-06-19
- approvedAt: 2026-06-19
- relatedTask: FEAT-037

## Context

All monetary amounts (procurement amount, HR colleague salary, HR payroll
base/bonus/deduction/net) are stored as integers in a currency's minor unit
(cents). The backend and seed data already follow this convention. The frontend
never implemented the minor<->major conversion: procurement amount inputs had no
`step` (default integer stepping) and were sent raw via `Number()`; HR inputs
used `step={1}` with a `Number.isInteger` guard that rejected decimals; and
`formatMoney` used `maximumFractionDigits: 0`, showing `850000` instead of
`8,500.00`. Result: users could not enter two-decimal amounts.

## Goal

Every currency field accepts and displays a two-decimal major-unit value while
storage stays minor-unit integer. Provide one reusable `MoneyInput` component
for currency input boxes.

## Proposal

Frontend-only. No schema, route, validation, or data migration changes.

- **Helpers** (`shared/lib/format.ts`):
  - `formatMoney(minor)` -> `Intl.NumberFormat` with `minimumFractionDigits: 2`
    and `maximumFractionDigits: 2` over `minor / 100`.
  - `parseMoneyToMinor(raw)` -> `Math.round(Number(raw) * 100)` or null on
    blank/invalid/negative.
  - `minorToInput(minor)` -> `(minor / 100).toFixed(2)` for edit prefill.
- **Global component** (`shared/components/money-input.tsx`): controlled
  `MoneyInput` whose `value`/`onChange` speak minor-unit integers; keeps a local
  draft string for smooth typing and re-normalizes from `value` on blur;
  `type="number" inputMode="decimal" step="0.01"`.
- **Procurement** create dialog uses `MoneyInput`; list `formatAmount` and
  detail inline-edit route through the helpers (quantity stays integer).
- **HR colleague** salary field becomes a `MoneyInput` (form holds minor
  number | null); mapping passes through.
- **HR payroll** dialog base/bonus/deduction use `MoneyInput` (state becomes
  number | null); drop the integer-only `parseAmount` guard.

## Verification

- `bun run check` exits 0 (includes web tests, lint, type-check).
- Manual: enter `1234.56` in procurement / salary / payroll -> persists and
  renders `1,234.56`.
