# FEAT-042 - Global currency list referenced by procurement & HR (+ THB)

- Status: Completed
- Plan: [PLAN-094](../plan/PLAN-094.md)
- Owner: session
- Created: 2026-06-20

## Summary

Currency is fragmented and free-text: the procurement form edits it as a
free-text input, HR uses a hard-coded picker list (`HR_PAYROLL_CURRENCIES`),
and the seeded `procurement.default_currency` setting has no consumer. There is
no single place to manage the currencies offered across the app.

Introduce a single globally-managed currency list that every surface
references, add a global settings tab to manage it, and add THB to the built-in
list.

## Goal

- A global currency list = built-in codes + admin-added custom codes.
- A new global settings tab ("General") with two categories: Currency and
  Contact Categories (the standalone Contact tab is removed and moved here).
- Admin can add/remove custom currencies; the list is readable by any
  authenticated user via a non-admin `GET /currencies` endpoint.
- Procurement form and HR (colleague salary + payroll) reference the global
  list instead of free-text / a hard-coded list.
- THB added to the built-in list (not a forced default — just one more option).
- Backward compatible: a record's existing (possibly legacy) currency stays
  selectable and is shown as-is; no schema/migration/validation changes.

## Acceptance Criteria

1. `GET /currencies` returns `{ builtin, custom }`, requires auth only (not
   admin), and `builtin` contains `THB`.
2. Admin "General" tab manages custom currencies (add validates a 3-letter
   uppercase code; remove drops it); Contact Categories moved into the same
   tab; Contact tab removed.
3. Procurement create/edit form currency is a dropdown sourced from the global
   list unioned with the row's current value; field stays optional.
4. HR colleague salary currency and payroll currency dropdowns source from the
   global list unioned with the record's current value.
5. `HR_PAYROLL_CURRENCIES` removed; its test updated.
6. Dead `procurement.default_currency` seed key removed.
7. `bun run check` passes (incl. regenerated api-docs / api-spec).

## Status Notes

- 2026-06-20: Created with [PLAN-094](../plan/PLAN-094.md); approved via the
  proposal exchange, implementation started. IDs FEAT-041/PLAN-093 were already
  taken by a concurrent procurement-status task.
- 2026-06-20: Completed. `bun run check` exits 0 (web 860 tests, api 1901 +
  routes 539, build, i18n sync, env-docs, api-docs, api-spec all green).
