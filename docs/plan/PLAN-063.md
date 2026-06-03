# PLAN-063 Virtual users as first-class user rows

- **status**: Implementing
- **owner**: l1-75ymcfnr / L2 fto2m2se
- **campaignId**: l1-75ymcfnr-vuser-20260603200111
- **tasks**: [REFACTOR-020](../task/REFACTOR-020.md), [FEAT-020](../task/FEAT-020.md), [REFACTOR-021](../task/REFACTOR-021.md)
- **createdAt**: 2026-06-03

## Goal

Today a "virtual member" is a `project_members` row with `userId=null` plus a
free-text `displayName` (`apps/api/src/modules/project/schema.ts:88-89`,
`project.routes.ts:106-107` — "userId OR displayName"). REFACTOR so virtual
users become **first-class rows in the `users` table**, created and managed in
the global admin Users area, with a globally-unique `username` (shared
`users.username` space → never collides with a real user), and seamlessly
convertible to a real login user later.

## Design (user-confirmed)

### users schema

- Add `isVirtual` integer boolean (`default 0`; real users 0, virtual 1).
- Keep `username` / `email` / `oauthSub` UNIQUE + NOT NULL.
- A virtual user has: `isVirtual=1`, a required UNIQUE `username` (validated
  against the WHOLE users table → global uniqueness), `name` (display),
  `role="user"`, `status="active"`, and SYNTHETIC login fields to satisfy
  NOT NULL + unique without a real login:
  - `oauthSub = "virtual:<id>"`
  - `email = "<username>@virtual.local"`
- Conversion to a real user later = flip `isVirtual` + replace
  `oauthSub`/`email` when the person gets a real login. (Conversion UI/endpoint
  is OUT OF SCOPE for this campaign; the data model just enables it.)

### Admin users API

- Create / list / update / delete VIRTUAL users (admin-only, reuse existing
  `adminRequired` gating). List + detail expose `isVirtual`. Real-user OIDC
  provisioning is UNCHANGED.

### Project members → always a users row

- Assignment ALWAYS uses `userId` → a `users` row (real OR virtual). DROP the
  `displayName` virtual-member path: member create/update REQUIRE `userId`
  (remove the "or displayName" refine + the promote-by-userId path).
- `project_members.displayName` column REMOVED (migration); `userId` becomes
  NOT NULL. Member/assignee display name resolves from the `users` row
  (server-side in `composeMember` → member view carries `name` + `isVirtual`).
- Dev phase: existing `displayName` virtual members are RESET (no data
  migration). Breaking changes OK, DB resettable, no compat shims.

### Assignable-vs-visible split (keeps sharing clean)

- `GET /account/visible-users` (sharing / comment mention pickers) stays
  REAL-only: filter `status="active" AND isVirtual=0`. (Virtual users are
  `active`, so they MUST be excluded here or they would leak into share
  targets.)
- NEW `GET /account/assignable-users` (authRequired, NOT admin) returns active
  users **real + virtual** with `isVirtual`, for the project member-add picker.

## Scope / Constraints

- Backend: `apps/api/src/modules/account/users/{schema,users.routes,users.service}.ts`,
  `apps/api/src/modules/project/{schema,project.routes,project.service}.ts`,
  `apps/api/drizzle/**` (migration via `bun run db:generate`), api tests.
  Note: `apps/api/src/db/embedded-migrations.ts` stays an EMPTY stub at rest
  (populated only by `bun run compile`); do NOT edit it — tests migrate from the
  on-disk `apps/api/drizzle/` folder.
- Frontend: admin Users page `apps/web/src/app/routes/_app/admin/users/index.lazy.tsx`
  + `apps/web/src/locales/{en,zh}/users.json` (L3-2); project members
  `-project-settings-members.tsx` + `-member-helpers.ts` + panels/tabs that
  resolve member/assignee labels + `apps/web/src/shared/lib/api/projects.ts`
  + `apps/web/src/locales/{en,zh}/projects.json` (L3-3).
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown teardown
  flake (exit1 with 0 real test failures).

## Acceptance Criteria

- `users.isVirtual` column + migration; virtual user create sets synthetic
  `oauthSub`/`email`, `role=user`, `status=active`, `isVirtual=1`.
- Admin API can create/list/update/delete virtual users; global username
  uniqueness rejects a `username` already used by ANY user (real or virtual).
- `project_members` has NO `displayName`; `userId` NOT NULL; member add/update
  require `userId`; member view exposes resolved `name` + `isVirtual`.
- `visible-users` is real-only; `assignable-users` returns real+virtual.
- Admin Users page: create virtual user (username + name), virtual badge,
  edit + delete virtual users.
- Project member-add + assignee pickers select a users row (real+virtual) by
  `userId`; the free-text displayName entry is removed; member rows show the
  resolved name + virtual badge.
- i18n en+zh parity for new strings; `bun run check` EXIT=0 (modulo @milkdown).

## Decomposition (3 L3; frontend depends on backend)

1. **L3-1 backend** (REFACTOR-020) — users.isVirtual + migration + virtual-user
   admin CRUD + global username uniqueness + `assignable-users` + visible-users
   real-only + members `userId`-only (drop displayName, member view name +
   isVirtual) + tests.
2. **L3-2 frontend admin** (FEAT-020, deps L3-1) — admin Users create/edit/
   delete virtual user + virtual badge + i18n.
3. **L3-3 frontend members** (REFACTOR-021, deps L3-1) — member-add + assignee
   pickers → unified users (real+virtual) by userId; remove displayName entry;
   member view name + badge + i18n + tests.

L3-2 and L3-3 are file-disjoint (admin/users vs projects/members) and run in
parallel after L3-1 merges.
