# FEAT-056 - HR colleague list: employment type, department, work location and hire-date filters

- Status: Completed (2026-08-02)
- Plan: [PLAN-107](../plan/PLAN-107.md)
- Created: 2026-08-02

## Goal

The colleagues list can only be narrowed by free-text search and status. Add
the filters an HR user actually reaches for — employment type, department,
work location, and a hire-date range — using the profile columns that already
exist on every colleague row.

## Scope

API:

- `GET /hr/colleagues` accepts optional `employmentType`, `department`,
  `workLocation`, `hireDateFrom`, `hireDateTo`; `listColleagues` ANDs them
  with the existing `q` / `status` conditions.
- New `GET /hr/colleagues/facets` -> `{ departments, workLocations }`:
  distinct non-empty values over the whole table, sorted, so the dropdowns are
  not limited to the current page.
- `describeRoute` coverage + regenerated api docs / spec / types.

Web:

- `HrColleaguesQuery` and the query-string builder carry the new params;
  new `useHrColleagueFacets()` hook.
- Colleagues page: three more `ListFilter` dimensions plus a hire-date range
  pair; every filter change resets to page 1.
- `locales/{en,zh}/hr.json` filter labels.

Out of scope: gender filter, saved filter presets, sorting, CSV export.

## Verification

- `hr.routes.test.ts`: each filter narrows, filters AND, invalid enum/date
  422s, facets dedupe and drop empty strings.
- `-colleagues-page.test.tsx`: filter selection reaches the request query.
- `bun run check` EXIT 0.
