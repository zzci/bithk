# FEAT-025 - Rename finance module to HR with approvals/payroll placeholders

- Status: Completed
- Plan: [PLAN-077](../plan/PLAN-077.md)
- Campaign: local
- Owner: session
- Created: 2026-06-10

## Summary

The colleagues feature (FEAT-021) is the sole content of the `finance` module,
but colleagues are semantically an HR concern. Rename the module end to end
from `finance` to `hr` (backend module, API routes, database table, backup
contribution, web routes, navigation, i18n), and pre-mount two placeholder
sub-modules — Approvals and Payroll — under the HR section without
implementing them.

## Acceptance Criteria

- Backend module lives at `apps/api/src/modules/hr` and serves
  `/hr/colleagues` (admin-only CRUD, archive-on-delete semantics unchanged).
- Database table is renamed `finance_colleagues` -> `hr_colleagues` via a
  Drizzle-generated migration (no hand-written SQL); existing rows survive.
- Backup contribution is registered as `hr` and still depends on `users`.
- Web routes move to `/hr/colleagues`; `/hr/approvals` and `/hr/payroll`
  render placeholder pages; an `/hr` layout owns the admin guard and a tab
  nav (Colleagues / Approvals / Payroll), mirroring the ship-tabs pattern of
  one URL per tab.
- Sidebar entry is renamed to HR (人事) and points at `/hr/colleagues`.
- i18n namespace `finance` is renamed to `hr` in en and zh; colleague copy
  drops the "Finance" qualifier.
- Docs follow: `docs/modules/finance.md` -> `docs/modules/hr.md`, database
  and API references updated, `api-routes.md` regenerated.
- `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/finance/**` -> `apps/api/src/modules/hr/**`
- `apps/api/src/db/schema.ts`, `apps/api/src/routes/protected.ts`
- `apps/api/drizzle/**` (generated)
- `apps/web/src/app/routes/_app/finance/**` -> `apps/web/src/app/routes/_app/hr/**`
- `apps/web/src/app/routes/_app/-finance.nav.ts` -> `-hr.nav.ts`
- `apps/web/src/shared/components/sidebar/registry.ts`
- `apps/web/src/shared/lib/api/finance*.ts` -> `hr*.ts`
- `apps/web/src/locales/{en,zh}/finance.json` -> `hr.json`
- `docs/modules/`, `docs/reference/`, `docs/changelog.md`

## Dependencies

- [FEAT-021](FEAT-021.md) / [PLAN-073](../plan/PLAN-073.md) (the module being
  renamed).

## Status Notes

- 2026-06-10: Created with [PLAN-077](../plan/PLAN-077.md); approved by user
  (Option A full rename + placeholder Approvals/Payroll sub-modules).
  Implementation started.
- 2026-06-10: Completed. Backend module renamed to `hr` with Drizzle rename
  migration `0002` (`ALTER TABLE ... RENAME` + rebuild, data preserved);
  backup contribution renamed to `hr`. Web: `/hr` layout owns the admin
  guard and a Colleagues/Approvals/Payroll tab nav (`-hr-tabs.ts` registry,
  ship-tabs pattern); approvals/payroll render a shared placeholder; `/hr`
  index redirects to colleagues; sidebar entry HR (人事) with IdCard icon;
  API client and i18n namespace renamed. Docs moved to `docs/modules/hr.md`,
  references updated, `api-routes.md` regenerated. `bun run check` EXIT 0.
