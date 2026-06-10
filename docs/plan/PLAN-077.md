# PLAN-077 - Rename finance module to HR with approvals/payroll placeholders

- Status: Completed
- Task: [FEAT-025](../task/FEAT-025.md)
- Campaign: local
- Created: 2026-06-10

## Context

FEAT-021 shipped a `finance` module whose only feature is colleagues
management (`finance_colleagues` table, `/finance/colleagues` admin CRUD,
`/finance/colleagues` web page, sidebar entry "Finance"). The user determined
colleagues belong to an HR domain, not Finance, and wants the grouping to
mirror how work orders belong to projects: HR is the section, colleagues is
one of its sub-pages. Two more HR sub-pages — Approvals and Payroll — must be
pre-mounted as visible placeholders with no functionality.

The sidebar `NavItem` registry is flat (no children), so sub-module structure
is expressed through routes: an `/hr` layout route renders a tab nav and an
`Outlet`, the same first-class-route-per-tab pattern used by ship detail tabs
(`-ship-tabs.tsx`).

## Proposal

1. Backend rename (`apps/api`):
   - `src/modules/finance/` -> `src/modules/hr/`; files `finance.*` -> `hr.*`.
   - Symbols: `financeColleagues` -> `hrColleagues`,
     `FINANCE_COLLEAGUE_STATUSES` -> `HR_COLLEAGUE_STATUSES`,
     `FinanceColleagueStatus` -> `HrColleagueStatus`, `financeRoutes` ->
     `hrRoutes`, `financeBackupContribution` -> `hrBackupContribution`
     (registered name `hr`).
   - Table `finance_colleagues` -> `hr_colleagues`; indexes
     `idx_finance_colleagues_*` -> `idx_hr_colleagues_*`.
   - Routes `/finance/colleagues*` -> `/hr/colleagues*`.
   - Update `src/db/schema.ts` export and `src/routes/protected.ts` mount.
   - Generate the migration with the project command (choose RENAME in the
     drizzle-kit prompt; never hand-author SQL).
2. Frontend rename + HR section (`apps/web`):
   - New `/hr` layout route owning the admin guard (moved from the colleagues
     lazy route) and a 3-tab nav: Colleagues / Approvals / Payroll.
   - `routes/_app/finance/**` -> `routes/_app/hr/**`; colleagues page keeps
     its behavior; add `approvals` and `payroll` placeholder routes rendering
     an empty-state card; `/hr` index redirects to `/hr/colleagues`.
   - Nav: `-finance.nav.ts` -> `-hr.nav.ts` (key `hr`, labelKey `hr:nav`,
     icon IdCard, path `/hr/colleagues`, matchPrefix `/hr`, same order 50).
   - API client `shared/lib/api/finance.ts` -> `hr.ts` (`/hr/colleagues`
     endpoints, query keys `["hr", "colleagues", ...]`, renamed hooks/types).
   - Locales `finance.json` -> `hr.json` (en/zh): nav HR/人事, colleague copy
     drops the Finance qualifier, new `tabs.*` and placeholder strings.
3. Docs: `docs/modules/finance.md` -> `docs/modules/hr.md`, update database
   and API references, regenerate `api-routes.md`, changelog entry.
4. Verify with `bun run check`.

## Risks

- drizzle-kit's interactive create-vs-rename prompt must be answered RENAME;
  a wrong answer produces a destructive drop+create migration. Verify the
  generated SQL contains `ALTER TABLE ... RENAME` before committing.
- Existing backup-v2 archives exported under module name `finance` will not
  map to the renamed `hr` contribution. Accepted: the module shipped
  yesterday, dev-stage data only.
- Route renames regenerate `routeTree.gen.ts`; e2e/specs referencing
  `/finance` paths must be swept.

## Scope

Backend module rename + one generated migration; web routes/nav/api
client/i18n; placeholder Approvals and Payroll pages (UI only, no API);
docs/reference updates. Explicitly out of scope: any approvals or payroll
functionality, permissions model changes, backup archive migration tooling.

## Alternatives

- Frontend-only regrouping (keep `/finance` API and table): rejected — leaves
  permanent naming mismatch for a one-day-old module.
- Sidebar child items: rejected — `NavItem` has no children; the codebase
  expresses sub-structure via routes (ships, projects).

## Annotations

- 2026-06-10: Approved by user (Option A + pre-mounted Approvals/Payroll
  placeholders). Implementation started.
- 2026-06-10: Completed as proposed. drizzle-kit's create-vs-rename prompt
  required a real TTY (piped stdin is rejected); driven via tmux send-keys,
  RENAME selected, generated SQL verified to be `ALTER TABLE ... RENAME` +
  table rebuild with row copy. Admin guard moved from the colleagues lazy
  route into the `/hr` layout so all sub-modules are gated in one place.
  Full `bun run check` EXIT 0.
