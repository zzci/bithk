# PLAN-076 - Global roles with per-module visibility

- Status: Completed
- Task: [FEAT-024](../task/FEAT-024.md)
- Campaign: local
- Created: 2026-06-10

## Context

Module access today is binary at the global level:

- `users.role` is an enum of `"admin" | "user"`
  (`apps/api/src/modules/account/users/schema.ts`).
- Backend: `adminRequired` middleware guards admin-only route groups
  (`apps/api/src/shared/middleware/auth.ts`); the policy middleware
  short-circuits all checks for admins
  (`apps/api/src/modules/policy/middleware.ts`).
- Frontend: the sidebar renders the admin section only when
  `user.role === "admin"` (`apps/web/src/shared/components/app-sidebar.tsx`);
  the `/admin` route redirects non-admins. All main-area modules (documents,
  drive, projects, ships, contacts) are visible to every authenticated user
  with no per-module gate.
- Navigation is a static registry
  (`apps/web/src/shared/components/sidebar/registry.ts`) of route-local
  `*.nav.ts` items with `area: "main" | "admin"`.
- A Zanzibar-style relation-tuple policy module exists for resource-level
  sharing (documents, drive, contacts), and per-project roles with 12
  capabilities exist for project-scoped permissions. Neither models
  app-level module visibility.

The requirement: grant modules per global role so different users see
different module sets — e.g. regular staff must not see future HR and
Finance modules ([PLAN-073](PLAN-073.md) plans Finance as admin-only for its
first pass and explicitly defers a capability model to a follow-up; this
plan is that follow-up framework).

## Assumptions

- One user holds exactly one global role (mirrors the per-project membership
  model). Multi-role union is listed as an alternative, not built now.
- The admin flag stays as-is: `users.role === "admin"` keeps full bypass and
  sees all modules. Global roles scope what NON-admin users can access.
- Gateable modules in v1 are the main-area modules: `documents`, `drive`,
  `projects`, `ships`, `contacts` — plus any future module (finance, hr)
  that registers a module key. `overview` and global search are always
  available. Admin-area modules (users, policies, audit, cron, settings,
  backup) remain admin-only and are NOT role-grantable in v1.
- Hiding a module blocks its API surface too, not just navigation.
- HR module itself is out of scope; this plan only delivers the framework a
  future HR/Finance module plugs into.

## Proposal

1. Schema: `global_roles` table (account module).
   - Columns: `id`, `name` (unique), `modules` (JSON `string[]` of module
     keys), `isSystem` (0/1), `kind` (`'default' | null`), `createdAt`,
     `updatedAt` — mirroring the proven `project_roles` shape.
   - One system role seeded at boot via backfill (same self-healing pattern
     as `backfillProjectRoles`): kind=`default`, name "Member", modules =
     all current main-area modules. Undeletable; admins may edit its module
     set.
   - `users.globalRoleId` nullable FK → `global_roles.id`, `ON DELETE SET
     NULL`; `NULL` resolves to the system default role. Existing users
     therefore keep exactly today's visibility — zero behavior change at
     rollout.
   - Migration generated with `bun run db:generate`; never hand-authored.

2. Backend module registry + enforcement.
   - A static `MODULES` const in the API (key, route prefixes, i18n label
     key): e.g. `documents -> /documents, /shared`, `drive -> /drive`,
     `projects -> /projects` (covers nested issues/procurements/worklists),
     `ships -> /ships`, `contacts -> /contacts`.
   - Middleware on the protected router: resolve the actor's allowed module
     set (admin → all; else role modules); a request whose path maps to a
     module outside the set → `NotFoundError` (404), extending the
     fail-closed concealment policy of decision 003 to the module level so
     hidden modules are indistinguishable from nonexistent ones.
   - Allowed modules are also enforced where data crosses modules: global
     search filters result domains to visible modules; cross-module pickers
     and reference endpoints inside a hidden module are covered by the
     prefix gate.

3. `/account/me` returns `modules: string[]`.
   - Computed server-side (admin → all keys). The web app treats this as the
     single source of truth for module visibility.

4. Frontend gating.
   - `NavItem` gains an optional `module` key; main-area nav items declare
     theirs. `getNavItems` (or the sidebar) filters by `me.modules`.
   - A module guard in the `_app` route layer maps the current route group
     to a module key and redirects to `/overview` when not visible (same
     pattern as the existing `/admin` guard).
   - Command palette / global search UI only offers visible modules.

5. Admin UI: global roles management.
   - New admin page `Roles` (`/admin/roles`): role list + in-page editor
     with a module checkbox table, reusing the in-page project-role editor
     pattern (PLAN-065) and the existing admin nav registry.
   - Users admin page: a role select column/field to assign a user's global
     role (default role preselected).
   - i18n: en + zh keys for module labels, page strings.

6. Module registration contract for future modules.
   - A new module (e.g. finance per PLAN-073) adds one `MODULES` entry +
     one `module` key on its nav item, and is then immediately grantable
     per role. Document this in `docs/modules/` and the architecture doc.

7. Docs and tests.
   - Update `docs/architecture.md` (authorization section), add
     `docs/modules/` notes, API/database references.
   - API tests: role CRUD, default-role resolution, prefix gate (allowed /
     denied / admin bypass), `me.modules`, search filtering.
   - Web tests: sidebar filtering, route guard redirect, roles admin page,
     user role assignment.
   - `bun run check` green.

## Risks

- Coverage gaps in the route→module map are the main security risk: an
  unmapped route under a gated module would stay reachable. Mitigate with a
  test asserting every mounted main-area route prefix is claimed by exactly
  one module key (or explicitly whitelisted as ungated).
- Cross-module leakage: search, dashboards/overview activity, notifications,
  and share links can reveal data from hidden modules. v1 filters search by
  visible modules and gates deep links via the route guard; overview widgets
  that aggregate gated modules must respect `me.modules`.
- Project membership vs module gate precedence: a user who is a member of a
  project but lacks the `projects` module loses access (module gate wins).
  This is intended but must be documented; admins removing `projects` from
  a role can silently cut working members off.
- The static prefix gate adds one role lookup per request for non-admins;
  cache the role's module set per session/request to keep overhead trivial.
- Sidebar and command palette already render from a registry, so frontend
  risk is low; the main UI risk is forgetting a hardcoded link into a gated
  module.

## Scope

Backend: account module schema + global-roles service/routes, protected
router middleware, `me` payload, search filtering; generated Drizzle
migration. Frontend: nav registry typing, sidebar filtering, module route
guard, admin Roles page, users page role select, i18n. Docs + focused tests.
No new dependency.

Out of scope: HR/Finance module implementation (PLAN-073 owns finance),
multi-role per user, per-module capability levels (view/manage) at the
global layer, making admin-area modules role-grantable, overview dashboard
widget filtering by visible modules (deferred per user decision), and any
change to per-project roles or the tuple policy engine.

## Alternatives

- Extend the `users.role` enum with fixed roles (e.g. `staff`, `finance`,
  `hr`): no new table, but every new role/module combination is a code
  change and enum migration; rejected as inflexible.
- Model module access as relation tuples (`namespace: module`, grant per
  user/group via the existing policy engine): reuses infra, but admins
  would manage visibility through the raw tuple editor with no role
  concept, and the requirement is explicitly role-based; rejected for UX.
- Per-user module grants table without roles: simplest schema, but admin
  burden grows per user and contradicts the role-based requirement.
- Multiple roles per user with module-set union: more flexible; deferred
  until a concrete need appears, since it complicates assignment UI and
  reasoning. The single-FK schema can evolve to a join table later.

## Resolved Questions

- Hidden-module API responses return 404 (user decision 2026-06-10),
  extending decision 003's fail-closed concealment to the module level.
- The default system "Member" role starts with all current main-area
  modules and its module set is editable by admins (user decision
  2026-06-10) — zero visibility change at rollout, trim afterwards.
- Overview dashboard widget filtering by visible modules is NOT needed in
  v1 (user decision 2026-06-10); nav + route guard + API gating suffice.

## Annotations

- 2026-06-10: Drafted after investigating the global role model, policy
  middleware admin bypass, sidebar nav registry, per-project roles pattern,
  and PLAN-073 (finance, admin-only first pass). Awaiting approval before
  implementation.
- 2026-06-10: User resolved the three open questions (404 concealment;
  editable default Member role; no overview widget filtering in v1).
  Awaiting explicit `proceed` for implementation.
- 2026-06-10: Completed. Implemented across four lanes: (A) `global_roles`
  schema + boot backfill + `users.globalRoleId` FK + `MODULES` registry +
  admin `/global-roles` CRUD + migration 0003; (B) module gate middleware
  with 404 concealment, admin bypass, `UNGATED_PREFIXES` and a route-prefix
  coverage test, `me.modules`, search domain filtering — HR's per-route
  `adminRequired` removed because the gate owns access; (C) `NavItem.module`
  + sidebar filtering, generic `_app` module guard (redirect to
  `/overview`), command palette filtering, hr nav in the main area; (D)
  `/admin/roles` in-page editor, users-page global-role select,
  `PATCH /account/users/:id` `globalRoleId`, en/zh i18n. All three user
  decisions applied; note the default Member role seeds WITHOUT `hr` to
  preserve rollout-day visibility — hr's admin-only behavior is now achieved
  by non-grant rather than per-route admin checks. Overview widget filtering
  stays deferred. Docs: architecture authorization model, module
  registration contract in the recipe, account/hr/search module docs,
  database + api references, changelog.
