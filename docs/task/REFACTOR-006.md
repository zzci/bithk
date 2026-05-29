# REFACTOR-006 Align project issues with the access issue reference

- Status: In Progress
- Plan: [PLAN-032](../plan/PLAN-032.md)
- Owner: BKD L2 (campaign l1-lsqiuvv9-20260528225223)
- Updated: 2026-05-28

## Goal

Make the BITHK project issue module a 1:1 functional and UI copy of the
`/app/zzci/access` issue implementation, with exactly one intentional product
delta: every issue belongs to a project (project ownership) and assignment
targets project members. Preserve the existing attachment/comment upload UI and
backend routes.

## Reference

Source of truth: `/app/zzci/access` issue module.

- Backend: `apps/api/src/modules/issue/{schema,issue.service,issue.routes,issue.test,issue.routes.test}.ts`
- Frontend: `apps/web/src/app/routes/_app/portal/issues/{index,$issueId}.{tsx,lazy.tsx}`,
  `-issue-panel.tsx`, `-issues.nav.ts`, `shared/components/resource/*`
- i18n: `apps/web/src/locales/{en,zh}/issues.json`
- e2e: `tests/e2e/modules/issue/{issues,attachments,comment-attachments}.test.ts`
- Doc: `docs/modules/issue.md`

## Current divergence (investigation summary)

BITHK already follows the access backend structure plus project ownership.
Divergences from access:

1. UI list is a status-grouped collapsible work-order list, not the access flat
   table with search + status/priority filters + resizable drawer + fullscreen
   detail. **This is the main parity gap.**
2. BITHK detail panel uses a 2x2 zen-mode meta grid; access uses an inline meta
   row with inline title/description editing.
3. BITHK-specific extras not present in access:
   - `items.pinned`/`pinnedAt` + pin/unpin routes (powers project pinned-home).
   - `issue_references` table + reference routes + `/ships/:id/maintenance-orders`
     (powers the ship maintenance-order feature).
   - `searchIssues` global membership-scoped search.

## Acceptance

- Backend issue CRUD, permissions, audit events, comments, attachments
  (upload/list/download/delete + comment attachments), and tests match access as
  closely as possible, adapted only for project scoping.
- The only intentional backend product delta is project ownership: every issue
  belongs to a project; routes stay `/api/projects/:projectId/issues`; assignment
  targets `project_members.id`.
- UI matches the access issue list/detail flow 1:1 in behavior and layout
  (flat list with search, status + priority filters, resizable drawer,
  fullscreen detail page, inline title/description editing,
  status/priority/assignee/due-date controls, comments, attachment
  upload/preview/download/delete), adapted only for project nesting and project
  member assignment.
- File upload UI and backend routes are preserved and still pass.
- Shared `resource/*` components stay compatible with the document/file users.
- BITHK-specific issue UI that conflicts with parity is removed/hidden, except
  where it is required by project ownership or by other shipped modules (see
  Decisions).
- English PMA docs/changelog and `docs/modules/issue.md` record the intentional
  project-ownership delta.
- Focused backend issue tests, focused frontend issue/resource tests, e2e issue
  attachment/comment tests where feasible, and `bun run check` pass; pre-existing
  unrelated failures are reported precisely.

## Decisions (intentional deltas from access — confirmed by L1)

Access is the reference baseline; the following are intentional BITHK deltas and
must NOT be removed or hidden during parity work:

1. **Project ownership** — project-scoped routes (`/api/projects/:projectId/issues`)
   and project-member assignment (`assignee_member_id`).
2. **Issue pin/unpin** — `items.pinned`/`pinnedAt` + pin/unpin routes. Integrate
   into the access-style list as the smallest possible affordance (one row
   action) without disturbing the access list/detail/upload/comment flow.
3. **Issue references** — `issue_references` + reference routes +
   `/ships/:id/maintenance-orders`. Access has no equivalent; keep BITHK
   behavior as-is, integrated minimally without disturbing the access-style flow.

Other kept extra:

- **global search** (`searchIssues`) — used by the command palette; not part of
  the issue list UI, no parity impact.

## List UI refinement (user request 2026-05-28, supersedes flat-table detail)

The main work-order list keeps a status-grouped/sectioned layout (not the access
flat table). Accepted criteria:

- Top toolbar has search + create adjacent as primary actions.
- Priority filter removed from the visible top filter controls.
- Top status filters remain and are clickable.
- Each status section header is clickable and filters/selects that status,
  consistent with the top status filter.
- Status group/header rows are full-width bars with a background and polished
  spacing; overall list layout/spacing improved.
- pin, references, uploads, assignment, and project-scoped behavior still work;
  access-style detail/drawer/upload/comment flow preserved.
- List visual refined to a Linear-style grouped layout per the user reference
  image: full-width muted section bars (chevron + status + count + per-section
  quick-add), compact single-line rows (status icon, short-id, title, aligned
  right meta: priority signal, comment count, overdue-colored due date, member
  avatar). Uses only existing issue fields; no fabricated tags/sub-issue meta.

## Scope

In scope: `apps/api/src/modules/issue/*`, issue-required integration with
`item`/`file`/comment modules, `apps/web/src/app/routes/_app/projects/*issue*`,
`apps/web/src/shared/components/resource/*` (only to preserve upload),
`apps/web/src/shared/lib/api/projects.ts` issue hooks, `locales/{en,zh}/issues.json`,
`tests/e2e/modules/issue/*`, and docs.

Out of scope: project-detail redesign beyond issues, procurement/contact/ship
domain changes, dependency upgrades, auth/policy redesign beyond issue
permissions, a global `/api/issues` page (project ownership must remain),
hand-authored migrations (coordinate with CHORE-002).

## Notes

- 2026-05-28 - Investigation by BKD L2 for campaign
  `l1-lsqiuvv9-20260528225223`. Backend already structurally mirrors access with
  project ownership; the dominant gap is the frontend list/detail UI. Migration
  ownership stays with CHORE-002/PLAN-030; if schema changes are needed they go
  through Drizzle generate, not hand-authored SQL.
