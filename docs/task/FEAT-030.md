# FEAT-030 - HR colleague detail drawer with profile metadata and documents

- Status: Completed
- Plan: [PLAN-079](../plan/PLAN-079.md)
- Campaign: local
- Owner: session
- Created: 2026-06-12

## Summary

Give the HR colleagues sub-module a detail experience built on the shared
`ResizableDrawer` (the same global drawer used by contacts / issues /
procurement). Clicking a colleague row opens the drawer to a view of the
colleague's profile metadata — adding birthday, hire (onboarding) date, and
salary payment (bank receiving) info to the existing identity fields — and a
personal-document section that supports uploading multiple files (passport,
certificates, etc.). Editing and creating happen in the same drawer panel,
retiring the standalone create/edit dialog.

## Acceptance Criteria

- `hr_colleagues` gains nullable columns for a standard employee profile:
  dates `birthday` / `hire_date` / `probation_end_date` / `contract_end_date`;
  enums `gender` / `employment_type`; text `nationality` /
  `personal_phone` / `personal_email` / `address` / `work_location`; and two
  JSON text columns — `payment_info` (array of
  user-defined `{ label, value }` rows) and `emergency_contacts` (array of
  `{ name, relation, phone, email, address }` contacts, repeatable). All via a
  Drizzle-generated migration (no hand edits).
- Colleague create/update routes and the web data layer accept and return the
  new fields; list rows carry them.
- Personal documents reuse the file module's generic `file_references`
  registry with `owner_type = "hr_colleague_document"` (no new table). New
  routes under `/hr/colleagues/:id/attachments`: upload, list, download
  (`?inline=true`), delete (admin or uploader), each asserting the colleague
  exists. Mirrors the procurement attachment routes.
- The colleagues page opens a `ResizableDrawer` colleague panel (create / view
  / edit modes), reusing `ResourceAttachmentSection` +
  `useResourceAttachmentUpload` for the documents block. The old
  `ColleagueDialog` is removed.
- en/zh i18n for the new fields and the documents section.
- Focused API route tests (new fields + attachment CRUD) and a panel/page
  test; `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/hr/schema.ts`, `hr.service.ts`, `hr.routes.ts`
  (+ a documents route file if extracted), `hr.routes.test.ts`
- `apps/api/drizzle/**` (generated)
- `apps/web/src/shared/lib/api/hr.ts`
- `apps/web/src/app/routes/_app/hr/-colleagues-page.tsx`,
  `-colleague-panel.tsx` (new)
- `apps/web/src/locales/{en,zh}/hr.json`
- `docs/modules/hr.md`, `docs/changelog.md`

## Dependencies

- [FEAT-021](FEAT-021.md) (colleagues module), [FEAT-025](FEAT-025.md) (HR
  rename). Reuses the shared file module and `resource` attachment components.

## Status Notes

- 2026-06-12: Created with [PLAN-079](../plan/PLAN-079.md); awaiting approval.
- 2026-06-12: Approved; field set finalized (no id_number, no education — ID
  numbers live in the document attachments). Implementation started.
- 2026-06-12: Completed. `hr_colleagues` gained the profile columns + two JSON
  columns (`payment_info`, `emergency_contacts`) via migration 0005; service,
  routes, and zod schemas carry them; new `/hr/colleagues/:id/attachments` CRUD
  reuses `file_references` (`owner_type` `hr_colleague_document`). Web: new
  `ColleaguePanel` in the shared `ResizableDrawer` (create/view/edit), documents
  block via `ResourceAttachmentSection` + `useResourceAttachmentUpload`, list page
  rewritten to drive the drawer (dialog removed), form logic split into
  `-colleague-form-logic.ts`. en/zh i18n + `common.resize`. Tests: profile-field
  + attachment-CRUD route tests, rewritten page test. Gates green: lint 0 errors,
  typecheck, API 1799/0, web 828/0, check:routes 511/0, i18n, api-docs, build.
  Note: the working tree also holds an unrelated in-flight FEAT-031/FEAT-032
  (roles→groups) campaign; a rare pre-existing sidebar-registry web-test flake
  (pure-function test, passes in isolation and on re-run) is from that work, not
  this feature.
