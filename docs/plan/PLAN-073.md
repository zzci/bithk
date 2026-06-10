# PLAN-073 - Finance colleagues module

- Status: Completed
- Task: [FEAT-021](../task/FEAT-021.md)
- Campaign: local
- Created: 2026-06-09

## Context

The repository has no existing `finance` module under `apps/api/src/modules` or
`apps/web/src/app/routes/_app`. Procurement exists, but it is project-scoped and
mounted under `/projects/:projectId/procurements`, so it is not a global Finance
domain container.

The account module already supports real and virtual users as first-class rows:

- `apps/api/src/modules/account/users/schema.ts` defines `users.isVirtual`.
- `listActiveUsers` intentionally returns active real users only for sharing and
  comment pickers.
- `listAssignableUsers` returns active real and virtual users and is already
  exposed through `/account/assignable-users`.
- Project members now require `userId` and join back to `users`; this is the
  correct precedent for colleague assignment.

Route and module wiring patterns:

- Backend modules export routes from `index.ts`, register backup contributions
  there when needed, and are mounted from `apps/api/src/routes/protected.ts`.
- Database tables are aggregated through one export line in
  `apps/api/src/db/schema.ts`.
- Drizzle migrations must be generated from schema changes with
  `bun run db:generate`; migration SQL must not be hand-authored.
- Frontend navigation is registered in
  `apps/web/src/shared/components/sidebar/registry.ts` using route-local
  `*.nav.ts` files.

## Assumptions

- "Colleague" means a Finance-domain internal person record, not a project
  member and not a contact.
- Each colleague links to exactly one active `users` row, real or virtual.
- A `users` row can have at most one colleague row.
- The first release needs colleague management only; expenses, payroll,
  reimbursement, approval flows, and ledger entries are out of scope.
- App admins manage finance colleagues. A separate Finance role/capability
  model is explicitly out of scope for this first pass.

## Proposal

1. Add a backend `finance` module.
   - Create `apps/api/src/modules/finance/schema.ts` with a
     `finance_colleagues` table.
   - Proposed fields: `id`, `userId`, `code`, `title`, `department`, `status`,
     `notes`, `createdAt`, `updatedAt`.
   - `userId` is `NOT NULL`, `UNIQUE`, and references `users.id`.
   - Use `ON DELETE RESTRICT` for `userId` so financial colleague records are
     not silently removed when a real or virtual user is deleted.
   - Add indexes for `status` and `userId`.

2. Add finance colleague service and routes.
   - Mount under `/finance/colleagues`.
   - `GET /finance/colleagues`: paginated list with optional search and status.
   - `POST /finance/colleagues`: create a colleague linked to an existing active
     real or virtual user.
   - `PATCH /finance/colleagues/:id`: update display metadata and status.
   - `DELETE /finance/colleagues/:id`: prefer soft archive or status change if
     the table may later be referenced by finance records; hard delete remains
     acceptable only if no downstream references exist.
   - Protect all colleague management routes with `adminRequired`.
   - Validate duplicate `userId` as a clean conflict response.
   - Return joined user data (`name`, `username`, `isVirtual`, `status`) so the
     UI does not need per-row user lookups.

3. Wire backend integration.
   - Export the schema from `apps/api/src/db/schema.ts`.
   - Mount routes in `apps/api/src/routes/protected.ts`.
   - Register a backup contribution for `finance_colleagues` with dependency on
     `users`.
   - Generate the Drizzle migration with the project command.

4. Add frontend data layer and route.
   - Create a finance API hook file for colleague list and mutations.
   - Add a `/finance/colleagues` route with a dense list page, search/status
     filters, create/edit dialog, and virtual-user badge.
   - Use `/account/assignable-users` for the required real-or-virtual user
     picker.
   - Add a Finance nav entry to the overview sidebar.

5. Update documentation and tests.
   - Add `docs/modules/finance.md`.
   - Update API and database references.
   - Add focused API route/service tests for create, duplicate user, missing
     user, list, update, and delete/archive behavior.
   - Add frontend API hook tests and page interaction tests for selecting real
     and virtual users.
   - Run `bun run check`.

## Risks

- User deletion semantics matter more in finance than in project membership.
  `ON DELETE RESTRICT` avoids accidental data loss but may require a clean
  conflict path when deleting virtual users that are finance colleagues.
- If Finance needs non-admin access later, this plan will need a follow-up
  capability model. Adding that now would be speculative, so it is intentionally
  out of scope.
- The archive-versus-delete decision affects future ledger references. Soft
  archive is safer if colleagues can be referenced by future finance records.
- Adding a new top-level sidebar item changes the app navigation and overview
  ordering; it should be kept minimal and tested through the nav registry.

## Scope

Expected implementation touches backend schema/routes/service/tests, generated
Drizzle migration, frontend route/API/hooks/i18n/tests, and module/reference
docs. No new dependency is planned.

## Alternatives

- Reuse project members: rejected because colleagues are Finance-global, while
  project members are project-scoped operators with project roles.
- Reuse contacts: rejected because contacts model external parties and viewer
  permissions, while colleagues must map to internal real or virtual users.
- Store only `userId` without a colleague table: simpler, but it leaves no place
  for Finance-specific status, title, department, future references, or audit
  targets.
- Allow many colleague rows per user: more flexible, but likely creates
  duplicate actor ambiguity in finance workflows. The first pass should enforce
  one colleague per user.

## Open Questions

- Should deletion be implemented as hard delete now, or should colleagues be
  archived from the start? — Resolved: archived from the start. DELETE sets
  `status = 'archived'` and never hard-deletes.

## Annotations

- 2026-06-09: Drafted after investigating existing user, virtual-user, project
  member, procurement, backup, route, sidebar, and migration patterns. Awaiting
  approval before implementation.
- 2026-06-09: User confirmed the first implementation should be admin-only.
- 2026-06-10: Completed as proposed. Backend schema/service/routes with
  Drizzle-generated migration, backup contribution (`deps: ["users"]`),
  frontend data layer + `/finance/colleagues` page + sidebar nav + i18n, and
  focused tests all landed. Deletion shipped as soft archive (open question
  resolved). Docs/reference updates landed with this entry; the API docs
  generator now mounts `financeRoutes`.
