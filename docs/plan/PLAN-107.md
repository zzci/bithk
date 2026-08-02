# PLAN-107 - HR completeness: colleague list filters + payroll history on the colleague detail

- Status: Planned
- Task: [FEAT-056](../task/FEAT-056.md), [FEAT-057](../task/FEAT-057.md)
- Campaign: local
- Created: 2026-08-02

## Context

- `GET /hr/colleagues` (`apps/api/src/modules/hr/hr.routes.ts:23`) accepts only
  `q` (name / username / code LIKE), `status`, `page`, `limit`.
  `listColleagues` (`hr.service.ts:120`) builds the WHERE from exactly those.
  The row already carries every profile column (`department`, `title`,
  `employmentType`, `workLocation`, `hireDate`, `gender`, …) — the data is
  there, only the filters are missing.
- The colleagues page (`apps/web/src/app/routes/_app/hr/-colleagues-page.tsx:127`)
  renders a single `ListFilter` dimension (status) plus the search box. The
  shared `ListFilter` (`shared/components/list-filter.tsx`) supports N
  independent single/multi dropdowns, so more dimensions are a drop-in.
- `department` / `workLocation` are free text with no vocabulary table
  (grep: no `department` reference outside the HR module), so a dropdown needs
  a distinct-value source. `selectDistinct` is already used in
  `apps/api/src/modules/issue/issue.service.ts:514`.
- The edit form writes `""` (not `null`) when a text field is cleared
  (`hr.routes.ts` `profileFields` are plain strings), so distinct values must
  drop empty strings.
- The colleague detail drawer (`-colleague-panel.tsx`) shows identity /
  personal / contact / emergency / employment / payment / notes / documents.
  It shows the *configured* monthly salary but nothing about what was actually
  paid.
- Payroll data for one colleague is already one call away: `GET /hr/payroll`
  supports `colleagueId` (`hr.payroll.routes.ts:28`), returns rows ordered
  newest period first plus per-currency net totals over the whole filtered set
  (`hr.payroll.service.ts:130`), and the web hook `useHrPayrollRecords`
  (`shared/lib/api/hr-payroll.ts:76`) already takes `colleagueId`.
- Access: everything under `/hr` sits behind one flat module gate
  (`shared/module-manifest.ts:67`, ADR-014); only "mark paid", "generate
  payroll" and "decide approval" additionally require admin. So a payroll
  block inside the colleague drawer exposes nothing the payroll tab does not
  already expose to the same audience.

## Approach

### FEAT-056 — colleague list filters (api + web)

1. `listQuerySchema` gains optional `employmentType` (enum), `department`
   (string), `workLocation` (string), `hireDateFrom` / `hireDateTo`
   (`YYYY-MM-DD`). `listColleagues` pushes `eq` conditions for the first three
   and `gte` / `lte` on `hire_date` for the range (string compare is correct
   for zero-padded ISO dates; rows with a NULL/empty `hire_date` drop out of a
   range filter, which is the expected reading of "hired between X and Y").
2. New `GET /hr/colleagues/facets` returning
   `{ departments: string[], workLocations: string[] }` — `selectDistinct`
   over the colleague table, empty/NULL removed, sorted ascending. No paging.
   It feeds the two dropdowns so options cover the whole table, not the
   current page. Registered before the `:id` sub-routes (no collision: there
   is no `GET /hr/colleagues/:id`).
3. `describeRoute` entries for both; regenerate `gen:api-docs`,
   `gen:api-spec`, `gen:api-types` (otherwise `check:api-*` fails).
4. Web `shared/lib/api/hr.ts`: extend `HrColleaguesQuery` +
   `colleaguesQueryString`, add `useHrColleagueFacets()`.
5. `-colleagues-page.tsx`: `ListFilter` gains `employmentType` (static enum
   options), `department`, `workLocation` (facet options); a hire-date range
   pair (`Input type="date"` ×2) sits next to the search box, mirroring the
   month input on the payroll page. Every change resets `page` to 1.
6. i18n `locales/{en,zh}/hr.json`: `colleagues.filter.*` labels.

### FEAT-057 — payroll history on the colleague detail (web only)

7. New `-colleague-payroll-section.tsx`: `useHrPayrollRecords({ colleagueId,
   limit: 12 })`, rendered as a `PanelSection` in `ColleaguePanelView` between
   payment and documents. Compact table — period, base / bonus / deduction,
   net, status badge, paid-at — plus the per-currency net total from
   `meta.totals` and a `{{count}} records` line when the total exceeds the 12
   shown. Loading / empty / error states match the rest of the panel.
8. i18n `colleagues.section.payrollHistory` + the section's own labels reuse
   the existing `payroll.*` keys where they already exist.

### Verification

9. API: extend `hr.routes.test.ts` — each new filter narrows correctly, the
   combination ANDs, unknown values 422, facets exclude empty strings and
   dedupe. `bun run check:routes`.
10. Web: extend `-colleagues-page.test.tsx` (filter → query string) and add a
    test for the payroll section (rows, totals, empty state).
11. `bun run check` EXIT 0.

## Backlog — surveyed HR gaps (NOT in this plan)

Ordered by impact; each is a candidate for a follow-up task.

1. **Approvals carry no time range.** `hr_approvals` has `type`, `title`,
   `reason` but no start/end date or duration, so a leave or business-trip
   request cannot say *which days*. Schema change + form + list columns.
2. **No HR overview.** `birthday`, `probationEndDate`, `contractEndDate` are
   write-only today — nothing surfaces expiring probations/contracts,
   headcount by department/employment type, or upcoming birthdays.
3. **HR writes are not audited.** Colleague create/update/archive, payroll
   create/pay/delete and approval decisions emit no audit events (colleague
   documents deliberately opt out, `hr.routes.ts:244`). Salary edits are
   exactly what an audit trail exists for.
4. **Approvals have no attachments**, while colleagues do — no sick note, no
   trip approval PDF. The shared `mountItemAttachmentRoutes` factory makes
   this cheap.
5. **Colleague pickers silently cap at 100.** `useHrColleagues({ limit: 100 })`
   in `-payroll-page.tsx:81` (filter dropdown) and `:391` (create dialog):
   colleague 101+ becomes unselectable with no indication.
6. **Payroll list has no colleague-name search** (only an exact-id dropdown)
   and no export/payslip output.
7. **Payroll generation is base-salary only** — recurring allowances or
   deductions must be typed per record every month.
8. **`hr_colleagues.code` is not unique** — two colleagues can share an
   employee code.
9. **No leave balance / quota.** Approving leave decrements nothing.
10. **No self-service scoping.** Anyone with the `hr` module can file and edit
    a request on behalf of any colleague; only the decision is admin-gated.
    Consistent with ADR-014's flat RBAC, listed for completeness.

## Alternatives Considered

- **Derive department / work-location options from the loaded rows** instead of
  a facets endpoint: only ever sees the current page (20 rows), so options
  silently change as you page. Rejected.
- **Substring match on a free-text department input** (no facets endpoint):
  smaller diff, but the user has to know the exact spelling and the filter bar
  stops matching the dropdown-chip pattern used everywhere else. Rejected.
- **A gender filter**: cheap to add but of no operational use, and a
  questionable filter to put in an HR product. Left out; say so if wanted.
- **Linking the payroll section to a pre-filtered payroll tab** instead of
  rendering rows inline: the payroll tab's filters are local state with no
  URL params, so a deep link needs search-param plumbing on that page. Kept
  out of scope; the inline list answers the question directly.

## Risks

- Generated artifacts (`api-routes.md`, spec, `_generated` types) must be
  regenerated in the same commit or `bun run check` fails.
- New query params must stay optional so existing callers and the e2e module
  test (`tests/e2e/modules/hr/hr.test.ts`) keep working.
- `hireDateFrom/To` string comparison assumes well-formed `YYYY-MM-DD`; the
  regex validator enforces it, and rows with an unset hire date are excluded
  by design — worth calling out in the UI copy if it surprises anyone.
- The facets endpoint exposes department / work-location strings to any
  hr-gated user; identical exposure to the list itself, no new surface.
