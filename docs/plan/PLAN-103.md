# PLAN-103 - Overview workbench: user favorites + my issues + open procurements

- Status: Completed
- Task: [FEAT-048](../task/FEAT-048.md)
- Campaign: local
- Created: 2026-07-01
- Completed: 2026-07-02

## Context

- `apps/web/src/app/routes/_app/overview.lazy.tsx` renders a welcome header and
  two static tiles linking to `/projects` and `/documents` — pure navigation,
  no data. Test: `-overview.lazy.test.tsx` asserts greeting + tiles only.
- Projects: `GET /api/projects` exists with `status` filter
  (`active | archived`), already scoped to the caller's visible projects
  (`apps/api/src/modules/project/project.routes.ts`). Web hook:
  `useProjects(query)` in `apps/web/src/shared/lib/api/projects.ts`.
- Procurements and issues are strictly project-scoped
  (`GET /api/projects/:projectId/procurements`, `.../issues`); there is no
  cross-project list. Procurement statuses: requested/ordered/confirmed/paid/
  in_transit/received/accepted/returned/refunded/cancelled. Issues carry
  `assigneeMemberId` (project member) resolvable to the current user.
- No user-level star/favorite exists outside drive.
- Sidebar gates nav by `user.modules` (`sidebar/visibility.ts`); the projects
  nav item requires the `projects` module.

Decisions (user, 2026-07-02):
- Show **user-curated favorites**, not active projects — nearly every project
  is `active`, so an auto list adds nothing over the projects page.
- Favorites live in a **standalone per-user table** in their own module so no
  existing module schema/route is touched; the same table pins projects and
  issues (extensible to more types) on the overview.

## Approach

### Backend — standalone favorites module

0. New `favorite` module (`apps/api/src/modules/favorite/`) owning table
   `user_favorites`: `userId`, `targetType` (`"project" | "issue" | "procurement"`),
   `targetId`, `createdAt`; composite PK (userId, targetType, targetId);
   `userId` FK cascade on user delete. No FK into target tables (types vary);
   dangling rows are filtered at read time. Migration generated via
   drizzle-kit only. NOTE: in-flight FEAT-047 already added migration 0005
   (uncommitted) — generate after syncing with it to avoid journal collision.
   Routes (protected, `describeRoute`):
   - `PUT /api/favorites/:type/:id` — idempotent; validates the target exists
     AND the caller can currently view it (project visibility / issue.view),
     else 404 (fail-closed, no existence leak).
   - `DELETE /api/favorites/:type/:id` — idempotent.
   - `GET /api/favorites` — caller's favorites hydrated for display (project:
     shortId/name/status/cover; issue: project ref/title/status/priority;
     procurement: project ref/itemName/status/amount+currency), re-checked
     against current visibility; non-visible or deleted targets are omitted.

### Backend — aggregate endpoint

1. New `GET /api/overview` (protected; registered like other modules, routes
   use `describeRoute` per the hono-openapi convention). Response:
   - `myIssues`: up to 10 issues in non-terminal statuses whose assignee
     resolves to the caller, across projects where the caller is a member with
     `issue.view`; each row carries `projectId/projectShortId/projectName`,
     title, status, priority, dueDate, updatedAt.
   - `openProcurements`: up to 10 procurements in non-terminal statuses
     (requested/ordered/confirmed/paid/in_transit) across projects where the
     caller holds `procurement.view`; row carries project ref, itemName,
     status, amount+currency, updatedAt.
   - Scoping is fail-closed: membership + capability subquery in SQL, no
     per-project loop. Users without the `projects` module get empty arrays
     (or the module gate the existing per-project routes use — match it).
2. Reuse existing service helpers where possible; no schema/migration change.

### Frontend — overview page rework

3. Replace the tile grid in `overview.lazy.tsx` with three sections:
   - **收藏 / Favorites**: from `useFavorites()` (`GET /api/favorites`) —
     project favorites as cards, issue favorites as compact rows;
     click-through; empty state links to the projects list ("star items to
     pin them here").
   - Star toggle UI: projects-list cards, project detail header, issue
     detail, and procurement detail (star icon; optimistic toggle; starred
     state derived from the favorites query, no changes to existing
     endpoints).
   - **我的工单 / My issues**: compact rows (project name · title · status ·
     priority), click-through to the issue.
   - **进行中的采购 / Open procurements**: compact rows (project name ·
     item · amount · status), click-through.
   Each section has an empty state; new hook `useOverview()` in
   `shared/lib/api/`.
4. Module fallback: if the caller lacks the `projects` module, keep the
   current quick-nav tiles (documents/drive) instead of the sections.
5. i18n: extend `locales/{en,zh}/overview.json`.

### Verification

6. API tests: scoping (non-member sees nothing; member without capability
   sees nothing; assignee filter correct; status filters correct).
7. Web tests: rework `-overview.lazy.test.tsx` for sections + empty states +
   module fallback.
8. Regenerate API docs (`gen-api-docs`) and run `bun run check`.

## Alternatives Considered

- **Active projects section** (no stars): rejected by user — almost all
  projects are `active`, so the section would not differentiate.
- **Per-module star columns / `starred` field on project rows**: rejected by
  user — a standalone favorites table keeps existing schemas untouched and
  extends to more target types without further migrations.
- **Frontend-only aggregation** (fetch projects, then N per-project queries):
  N+1 requests, slow and wasteful. Rejected.

## Risks

- Cross-project aggregation is security-sensitive: must mirror the per-project
  capability gates exactly (fail-closed). Covered by dedicated scoping tests.
- Concurrent in-flight work (FEAT-047 storage module) has uncommitted changes
  in `apps/api/src/app.ts` / `routes/protected.ts` and an uncommitted drizzle
  migration 0005; both module registration and migration generation must be
  additive and sequenced after/with it to avoid journal collisions.
- No FK to target tables → dangling favorite rows after target deletion;
  mitigated by read-time visibility re-check (rows silently omitted).
  Optional lazy cleanup can prune omitted rows on read.
- `PUT /favorites/:type/:id` must not become an existence oracle: return the
  same 404 for "not found" and "no access". Covered by scoping tests.
