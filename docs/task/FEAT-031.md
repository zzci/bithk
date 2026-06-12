# FEAT-031 - Global roles as user groups: counts, membership, dialog permissions

- Status: Completed
- Plan: [PLAN-080](../plan/PLAN-080.md)
- Campaign: local
- Owner: session
- Created: 2026-06-12

## Summary

Rework the admin global-roles page into a user-group style surface and pin
down the built-in role model. Exactly two system roles exist: **Admin**
(synthetic, backed by `users.role = "admin"`, full access, immutable) and
**Guest** (the `kind = "default"` fallback role, zero modules, immutable).
Every other role — including the former built-in "Member" — is a custom role.
The page shows each role with its user count, lets admins add users to a role
(search picker) and remove them, and edits role permissions in a dialog
instead of the inline editor.

## Acceptance Criteria

- Boot backfill enforces the system default role as `Guest` with empty
  modules; a legacy `Member` default role (non-empty modules) is demoted in
  place to a custom role (keeps id/name/modules, so explicit assignees are
  unaffected) and a fresh Guest default is created.
- `PATCH /global-roles/:id` refuses system roles (Guest locked); DELETE
  already refuses them. Deleting a custom role falls its users back to Guest
  (existing `SET NULL` FK).
- `GET /global-roles` returns `userCount` per role (non-admin users;
  `globalRoleId = NULL` counts toward the default Guest role).
- `GET /account/users` accepts a `global_role_id` filter (non-admin users;
  the default role id also matches `globalRoleId IS NULL`).
- `PATCH /account/users/:id` refuses demoting or disabling the last active
  admin (409).
- Seed creates a custom `Member` role (documents/drive/projects/ships/
  contacts) and assigns seeded users to it.
- `/admin/roles` is a two-column group layout (mirrors `/admin/users/groups`):
  left, role rows (Admin, Guest, customs) with member-count badges and a New
  role action; right, the selected role's members with debounced search-add
  and remove. Add to Admin = promote (`role: "admin"`); remove from Admin =
  demote; remove from a custom role = back to Guest; Guest members cannot be
  removed (fallback).
- Role permissions (name + module switches) edit in a Dialog; Admin and Guest
  open read-only dialogs (full access / no access).
- en/zh i18n; focused API + web tests; `bun run check` passes.

## Files in Scope

- `apps/api/src/modules/account/roles/roles.service.ts`, `roles.routes.ts`,
  `roles.routes.test.ts`
- `apps/api/src/modules/account/users/users.routes.ts`, `users.service.ts`,
  `users.routes.test.ts`
- `apps/api/scripts/seed/**`
- `apps/web/src/app/routes/_app/admin/-roles-page.tsx` (+ tests)
- `apps/web/src/shared/lib/api/global-roles.ts`
- `apps/web/src/locales/{en,zh}/roles.json`
- `docs/changelog.md`, generated API docs

## Dependencies

- [FEAT-024](FEAT-024.md) (global roles with per-module visibility).

## Status Notes

- 2026-06-12: Created with [PLAN-080](../plan/PLAN-080.md); proposal approved
  (A synthetic admin, B guest-as-floor, C last-admin guard, D Member becomes
  custom). Implementation started.
- 2026-06-12: Completed. `bun run check` EXIT 0 (api 1809+516, web 837, all
  green); live-verified via reseed + dev boot (Guest default backfilled,
  seed Member custom role assigned to 15 users). Note: the last-admin guard
  is unreachable in single-request HTTP semantics (self-edit blocked,
  disabled admins cannot authenticate) — it runs inside the mutation
  transaction to close the concurrent mutual-demotion race and is unit
  tested at the service level.
