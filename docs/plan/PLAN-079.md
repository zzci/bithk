# PLAN-079 - HR colleague detail drawer with profile metadata and documents

- Status: Draft
- Task: [FEAT-030](../task/FEAT-030.md)
- Campaign: local
- Created: 2026-06-12

## Context

The HR colleagues sub-module (`hr.service.ts`, `hr.routes.ts`,
`-colleagues-page.tsx`) is a flat admin/HR-gated list whose only detail
surface is a `Dialog` for create/edit. Colleague rows carry just identity
fields (`code`, `title`, `department`, `status`, `notes`) plus the joined
user. The user wants a richer detail view in the shared global drawer, more
profile metadata (birthday, salary payment info, onboarding date), and a
personal-document area that holds multiple uploaded files.

Reusable precedents already in the codebase:

- `ResizableDrawer` (`shared/components/resizable-drawer.tsx`) — the global
  right-side detail drawer used by contacts, issues, procurement.
- The contacts list + `ContactPanel` pattern
  (`routes/_app/contacts/index.lazy.tsx`, `-contact-panel.tsx`): one panel
  drives create / view / edit inside the drawer, with `DetailPanelHeader`.
- The file module's generic attachment registry: `file_references` keyed by
  `owner_type` / `owner_id` with no per-consumer table. Procurement
  (`procurement.routes.ts`) wires `uploadAndReference` /
  `listAttachmentsByOwner` / `getReferenceById` / `buildDownloadResponse` /
  `releaseReference` for `owner_type = "item_attachment"`.
- The reusable web attachment UI: `ResourceAttachmentSection` +
  `useResourceAttachmentUpload` (`shared/components/resource/`), which target
  any `/{resource}/{id}/attachments` endpoint.

## Proposal

1. **Schema** (`hr/schema.ts`) — append nullable columns to `hr_colleagues`
   for a standard employee profile. All appended at table end → plain
   `ALTER TABLE ADD COLUMN`; no defaults needed (JSON columns default `'[]'`).

   | Column | Kind | Notes |
   |---|---|---|
   | `birthday` | text `YYYY-MM-DD` | |
   | `hire_date` | text `YYYY-MM-DD` | onboarding date |
   | `probation_end_date` | text `YYYY-MM-DD` | |
   | `contract_end_date` | text `YYYY-MM-DD` | |
   | `gender` | text enum `male/female/other/undisclosed` | |
   | `employment_type` | text enum `full_time/part_time/contract/intern` | |
   | `nationality` | text | |
   | `personal_phone` | text | |
   | `personal_email` | text | |
   | `address` | text | residential address |
   | `work_location` | text | |
   | `payment_info` | text JSON, default `'[]'` | array of user-defined `{ label, value }` rows |
   | `emergency_contacts` | text JSON, default `'[]'` | array of `{ name, relation, phone, email, address }` |

   Migration generated via `bun run db:generate` (drizzle-kit); never
   hand-authored. Reset/replay dev DB after generating.

2. **Service** (`hr.service.ts`) — extend `colleagueColumns`, the create/
   update inputs, and the set-builder to carry every new field (same
   `=== undefined` guard style already used for `code`/`title`/...). The two
   JSON columns are stored as `JSON.stringify(entries)` and parsed back to
   typed arrays in `toColleagueView` (`payment_info` → `{ label, value }[]`,
   `emergency_contacts` → `{ name, relation, phone, email, address }[]`). No
   new invariants.

3. **Colleague document routes** (`hr.routes.ts`, or a small
   `hr.documents.routes.ts` mounted from `hrRoutes()`):
   - `POST   /hr/colleagues/:id/attachments` — content-length guard,
     `formData` `file`, `uploadAndReference({ ownerType:
     "hr_colleague_document", ownerId: colleague.id })`, return
     `makeAttachmentView`.
   - `GET    /hr/colleagues/:id/attachments` — `listAttachmentsByOwner`.
   - `GET    /hr/colleagues/:id/attachments/:aid` — `getReferenceById` →
     ownership check → `buildDownloadResponse` (`?inline=true`).
   - `DELETE /hr/colleagues/:id/attachments/:aid` — admin or `ref.createdBy
     === user.id` → `releaseReference`.
   Each first asserts the colleague exists (404 otherwise). Access stays
   under the HR module gate already applied by the protected router. No
   backup change: `file_references` are covered by the file module's own
   backup contribution (same as procurement attachments).

4. **Validation** (`hr.routes.ts`) — add the new optional fields to
   `createBodySchema` / `updateBodySchema`: the four dates as `YYYY-MM-DD`
   regex or empty; `gender` / `employmentType` as `z.enum(...)`; the plain
   text fields `max(200)` (`address` `max(500)`); `paymentInfo` as
   `z.array(z.object({ label: z.string().max(100), value: z.string().max(500) })).max(30)`;
   `emergencyContacts` as
   `z.array(z.object({ name: z.string().max(100), relation: z.string().max(100), phone: z.string().max(50), email: z.string().max(200), address: z.string().max(500) })).max(20)`
   (per-field optional/empty allowed).

5. **Web data layer** (`shared/lib/api/hr.ts`) — add the new fields to
   `HrColleagueRow`, `CreateHrColleagueInput`, `UpdateHrColleagueInput`. The
   document section uses the generic `resource` components directly (resource
   path `hr/colleagues`), so no bespoke attachment hooks here.

6. **Colleague panel** (`-colleague-panel.tsx`, new) — mirror `ContactPanel`:
   one component with `create | view | edit` modes inside `ResizableDrawer`
   via `DetailPanelHeader`.
   - View: grouped read sections — Identity (user, code, title, department,
     employment type, status), Personal (gender, birthday, nationality),
     Contact (personal phone, personal email, address),
     Emergency contacts (the `emergency_contacts` entries as contact cards),
     Employment (hire date, probation end, contract end, work location),
     Payment (the `payment_info` entries rendered as label/value rows), Notes —
     plus a Documents block rendering `ResourceAttachmentSection` + an upload
     button driven by
     `useResourceAttachmentUpload({ resource: "hr/colleagues", resourceId })`.
   - Edit: form over all fields, with the Payment block and the Emergency
     contacts block each an add/remove repeater (`{ label, value }` rows for
     payment; `{ name, relation, phone, email, address }` sub-forms for
     emergency contacts); user link immutable on edit, matching the current
     dialog; reuses the assignable-users picker for create.
   - Create: form only (Documents hidden until the colleague exists).

7. **Colleagues page** (`-colleagues-page.tsx`) — all create / view / edit move
   into the shared drawer: row click opens it in view mode; the toolbar
   "create" opens it in create mode; the `ColleagueDialog` is removed. Keep
   search, status filter, pagination, archive confirm. Pass the freshest row
   (re-derived from the list query by id) into the panel so edits reflect
   immediately.

8. **i18n** (`locales/{en,zh}/hr.json`) — keys for the new fields, the view
   section headers, and the documents/attachments block; reuse existing
   `common.*` keys where the resource components expect them.

9. **Tests** — extend `hr.routes.test.ts` for the new fields and the
   attachment CRUD (upload → list → download → delete, plus 404 on missing
   colleague and 403 on non-owner non-admin delete); a colleague panel/page
   test for view↔edit and the documents block. `bun run check` green.

## Risks

- Drizzle migration: appended columns should yield a clean `ADD COLUMN`, but
  drizzle-kit may still prompt; verify the generated SQL and replay on a reset
  dev DB before committing.
- Stale drawer data after edit — mitigated by re-deriving the panel's
  colleague from the live list query by id.
- Salary/payment info is sensitive; it is only exposed under the existing HR
  module gate (admin or `hr` global-role module), consistent with payroll.

## Scope

In: the items above. Out: per-employee self-service, document
versioning/categorisation, encryption of the payment fields, payroll
integration of the payment info, and any approvals/payroll changes.

## Alternatives

- Keep the create/edit `Dialog` and add a separate read-only drawer — more
  surfaces, diverges from the contacts global pattern; rejected.
- A dedicated `hr_colleague_documents` table — redundant with the generic
  `file_references` registry the file module exists to provide; rejected.
