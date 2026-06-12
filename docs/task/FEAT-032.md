# FEAT-032 - Merge global roles into groups (one grouping concept)

- Status: Completed
- Plan: [PLAN-081](../plan/PLAN-081.md)
- Campaign: local
- Owner: session
- Created: 2026-06-12

## Summary

Collapse the two user-grouping concepts into one. The `global_roles` entity
(FEAT-031) is removed; **groups** become the single grouping concept and
optionally carry module grants. A user's visible modules are the UNION of the
modules granted by the groups they belong to (admins still bypass; a user in
no module-granting group sees nothing — the floor survives). Groups keep
their existing role as sharing/policy subjects. The Roles page is deleted;
the Groups tab under Users gains the synthetic Administrators entry and a
per-group module-permissions editor in its dialog.

## Acceptance Criteria

- `groups` gains a `modules` JSON column (drizzle-generated migration);
  `global_roles` and `users.global_role_id` are dropped. Dev DB reset via
  seed (template project; no legacy-data conversion backfill).
- Group create/update accept optional `modules` (validated against
  `MODULE_KEYS`, 422 on unknown); group views and list include `modules`.
- Module resolution: admin → all keys; otherwise union over the user's
  groups' modules (policy membership tuples). The gate middleware moves to
  the groups module; `/global-roles` routes and the boot backfill are gone.
- `PATCH /account/users/:id` drops `globalRoleId`; the `global_role_id`
  list filter is removed (`group_id` already exists). Last-admin guard kept.
- Seed: groups payload entries carry `modules`; the Member-role seeding from
  FEAT-031 is removed.
- Web: Roles page/nav/data-layer/locales deleted. Groups tab gains the
  synthetic Administrators entry (count, member list, promote/demote) and a
  module switch table inside the group create/edit dialog. Users table drops
  the role column (groups column already shows memberships; admin badge
  stays).
- en/zh i18n moved into `groups.json`; focused API + web tests; `bun run
  check` passes.

## Files in Scope

- `apps/api/src/modules/account/groups/**` (schema, service, routes,
  module-gate, tests), `apps/api/src/modules/account/roles/**` (deleted),
  `apps/api/src/modules/account/users/**`, `apps/api/src/db/schema.ts`,
  `apps/api/src/app.ts`, `apps/api/src/routes/protected.ts`,
  `apps/api/src/modules/search/search.routes.ts`, `apps/api/drizzle/**`
  (generated), seed script + payload, affected route tests (contact, search,
  hr).
- `apps/web/src/app/routes/_app/admin/users/groups.lazy.tsx` (+ new test),
  `admin/users/index.lazy.tsx`, deleted roles page/nav/test,
  `shared/lib/api/global-roles.ts` (deleted), `shared/components/sidebar/registry.ts`,
  `locales/{en,zh}/{groups,users}.json`, `locales/{en,zh}/roles.json` (deleted).
- `docs/modules/account.md`, `docs/architecture.md`, `docs/changelog.md`.

## Dependencies

- Supersedes the roles surface of [FEAT-031](FEAT-031.md) (the group-style
  UI, counts, membership management and last-admin guard carry over).

## Status Notes

- 2026-06-12: Created with [PLAN-081](../plan/PLAN-081.md); user approved
  option B (full concept merge) after the A/B/C tradeoff review.
- 2026-06-12: Completed. Migration 0006 (drop `global_roles`, rebuild
  `users` without `global_role_id`, add `groups.modules`); full API suite
  1799/0, web suite green after registry-nav fix, i18n 21 namespaces in
  sync; live-verified via reseed + dev boot (groups carry modules,
  `global_roles` gone). NOTE: a concurrent session was implementing
  FEAT-030 (HR drawer) in the same tree — its in-flight type errors in
  `hr.routes.test.ts` are unrelated; this task's commit excludes FEAT-030
  files except the surgical group-grant rewiring in the three hr route
  tests.
