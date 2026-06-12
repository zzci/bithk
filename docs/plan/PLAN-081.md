# PLAN-081 - Merge global roles into groups (one grouping concept)

- Status: Completed
- Task: [FEAT-032](../task/FEAT-032.md)
- Campaign: local
- Created: 2026-06-12

## Context

After FEAT-031 two grouping concepts coexist: global roles (exclusive,
module visibility) and groups (multi-membership, sharing/policy subjects via
`group:<id>#member@user:<id>` tuples). Both now present a near-identical
group-style UI, which the user flagged as confusing. Approved direction:
one concept — groups — optionally carrying module grants; visibility is the
union of a user's groups' modules.

Semantic change accepted explicitly: exclusive single role → multi-group
union. Removing a user from their last module-granting group blanks their
module access (the Guest-floor behaviour survives as "no grants → no
modules"). Admins keep the `users.role` bypass; the synthetic Administrators
entry moves to the Groups tab.

## Proposal

1. **Schema** — `groups.modules` text JSON, default `[]`; drop
   `users.global_role_id` and the `global_roles` table (delete
   `account/roles/schema.ts`, remove the export from `db/schema.ts`).
   Migration via `bun run db:generate`; dev DB reset by seed (template
   project — no production data, no conversion backfill).

2. **Module gate relocation** — move `moduleForPath` / `moduleGate` /
   `getRequestUserModules` / `UNGATED_PREFIXES` from `account/roles/middleware.ts`
   to `account/groups/module-gate.ts`. `resolveUserModules(db, user)` now:
   admin → all `MODULE_KEYS`; else union of `parseModules(group.modules)`
   over the user's groups (`listGroupMembershipsForUser` → `groups` rows).
   Signature takes `{ id, role }` (group lookup needs the user id; the old
   `globalRoleId` field is gone). Drop `/global-roles` from
   `UNGATED_PREFIXES`. Update importers (`routes/protected.ts`,
   `search.routes.ts`, `users.routes.ts`).

3. **Groups API** — `createGroup`/`updateGroup` accept optional
   `modules: string[]` validated against `MODULE_KEYS` (422 unknown);
   `listGroups`/`getGroupById` views include parsed `modules`. No new
   routes.

4. **Account/users API** — delete `account/roles` module and its mount in
   `account.routes.ts`; remove the FEAT-031 `global_role_id` list filter and
   the `globalRoleId` PATCH field/validation from users routes/service;
   drop `globalRoleId` from `userColumns`. Keep the last-admin guard.
   Remove `backfillGlobalRoles` from `app.ts`.

5. **Seed** — groups payload entries gain `modules` (engineering:
   documents/drive/projects/ships; surveyors: documents/ships; operations:
   all five classic keys); drop the FEAT-031 Member-role block in
   `importUsers`.

6. **Web** — delete the Roles page, route, nav entry, data layer
   (`global-roles.ts`), tests, and `roles.json` locales (namespaces derive
   from the filesystem). Users table: drop the role column (groups column
   already shows memberships; the admin badge stays). Groups tab:
   - synthetic **Administrators** entry pinned above the group list
     (count from `users?role=admin&limit=1`, member panel from
     `users?role=admin`, add = promote, remove = demote, self excluded,
     409 `LAST_ADMIN` surfaced as toast);
   - the group create/edit dialog gains the module switch table
     (`MODULE_KEYS` moved to a small shared module since `global-roles.ts`
     dies); group rows unchanged otherwise.

7. **i18n** — module-name keys and the admin-entry/permission strings move
   into `groups.json` (en/zh); `users.json` drops `col.globalRole`.

8. **Tests** — groups: modules CRUD validation + union resolution + gate
   behaviour (port the relevant `middleware.test.ts` cases); users: drop
   `globalRoleId` cases, keep guard tests; contact/search/hr route tests
   switch their module grants from `createGlobalRole` to a
   group-with-modules helper. New web test for the groups tab (admins
   entry, modules dialog, membership). `bun run check` green; reseed +
   dev boot verification.

## Risks

- Union semantics: removing a user's last module-granting group silently
  blanks their app. Accepted (mirrors the Guest floor).
- Destructive migration (drop table/column): dev-only data; seed reset is
  the documented workflow. Backup archives from before the merge replay
  against the new schema only via the backup module's own versioning —
  out of scope here.
- `groups` previously had no module semantics; sharing behaviour is
  untouched (tuples unchanged), but any UI listing groups now implies
  permission weight — the dialog labels modules explicitly to keep the two
  facets distinguishable.

## Scope

In: items above. Out: project-level roles, per-group admin rights, backup
archive cross-version conversion, e2e suite updates beyond what `bun run
check` covers.

## Alternatives

- Keep both concepts, UI-merge only (option A) — rejected by user in favour
  of the more flexible single-concept model.
- Exclusive single-group assignment — rejected: loses the multi-membership
  sharing semantics groups already have.
