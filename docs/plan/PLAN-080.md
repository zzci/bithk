# PLAN-080 - Global roles as user groups: counts, membership, dialog permissions

- Status: Completed
- Task: [FEAT-031](../task/FEAT-031.md)
- Campaign: local
- Created: 2026-06-12

## Context

Admin status (`users.role` enum, gates `adminRequired`, bypasses module
visibility) and global roles (`users.globalRoleId` → `global_roles`, module
visibility for non-admins) are orthogonal. The current built-in is a single
`kind = "default"` system role named "Member" carrying five modules; users
with `globalRoleId = NULL` resolve to it. The `/admin/roles` page is a
dropdown + inline editor with no user counts and no membership management;
role assignment lives as a per-row select on `/admin/users`.

The admin groups page (`admin/users/groups.lazy.tsx`) already implements the
target visual pattern: left card with rows + member-count `Badge`, right card
with a member list, a debounced `GET /account/users?q=` search-add dialog,
and per-member remove.

Approved model: system roles are exactly **Admin** (synthetic view over
`users.role = "admin"`; no `global_roles` row, since a row would imply
modules govern admins when they bypass them) and **Guest** (the default
fallback role, zero modules, locked). Everything else — including "Member" —
is a custom role.

## Proposal

1. **Backfill** (`roles.service.ts` `backfillGlobalRoles`) — enforce the
   system default as Guest: if the `kind = "default"` row has non-empty
   modules (legacy Member), demote it in place to custom
   (`isSystem = 0`, `kind = NULL`, name/modules kept → explicit assignees
   keep their visibility) and insert a fresh `kind = "default"` `Guest` row
   with `modules = []`. Idempotent: a default row with empty modules is
   normalized to name "Guest". No schema change, no migration.

2. **Roles routes** (`roles.routes.ts`) —
   - `PATCH /global-roles/:id`: refuse `isSystem` roles (Guest is immutable).
   - `GET /global-roles`: add `userCount` per role via one grouped count over
     `users` (`role = "user"`; `globalRoleId IS NULL` buckets to the default
     role). Shared view type gains `userCount`.

3. **Users list filter** (`users.service.ts` / `users.routes.ts`) — query
   param `global_role_id`: constrain to `role = "user"` and
   `globalRoleId = :id`, or additionally `globalRoleId IS NULL` when `:id`
   is the default role. Admin membership is queried with the existing
   `role=admin` filter, so no new param needed there.

4. **Last-admin guard** (`users.routes.ts` PATCH, and DELETE if a user
   delete endpoint exists) — when the target is an active admin and the
   change demotes (`role: "user"`) or disables them, count other
   `role = "admin" AND status = "active"` users; zero → 409
   `LAST_ADMIN`. (Self-edit is already blocked; this closes the
   demote-the-only-other-admin-while-disabled gap.)

5. **Seed** (`apps/api/scripts/seed`) — create a custom `Member` role with
   the five classic modules and point seeded users' `globalRoleId` at it, so
   a reseeded dev DB doesn't render every seed account module-less under the
   new Guest floor.

6. **Web data layer** (`shared/lib/api/global-roles.ts`) — `GlobalRoleView`
   gains `userCount`; no new endpoints. Member lists reuse
   `GET /account/users` with `global_role_id` / `role=admin`; membership
   mutations reuse `PATCH /account/users/:id` (`{ globalRoleId }` or
   `{ role }`).

7. **Roles page rewrite** (`admin/-roles-page.tsx`) — two-column layout
   mirroring groups:
   - Left "Roles" card: synthetic **Admin** row (count from
     `users?role=admin&limit=1` meta.total, shield icon, System badge),
     **Guest** row (default role, System badge), then custom roles. Each row:
     name, member-count badge, view/edit-permissions action; custom rows also
     rename/delete. Header button "New role" → create dialog.
   - Right "Members" card for the selected role: paged user list (name,
     username/email), "Add member" dialog with 300 ms debounced
     `users?q=&limit=10` search (already-members filtered out; self
     excluded for Admin since self-PATCH is forbidden). Add → promote or
     assign; remove → demote (Admin) or `globalRoleId: null` (custom →
     Guest); Guest rows show no remove (it is the fallback) with an
     explanatory note.
   - 409 `LAST_ADMIN` and self-edit errors surface as toasts.
   - The old inline `RoleEditor` is removed.

8. **Permissions dialog** — one Dialog component: name input + module Switch
   table (logic lifted from the current inline editor) for create/edit of
   custom roles; read-only variants for Admin (all modules, note "full
   access") and Guest (none, note "no access"). Delete keeps the existing
   confirm flow, moved to the row action.

9. **i18n** (`locales/{en,zh}/roles.json`) — keys for the admin/guest
   built-ins, counts, members panel, add/remove dialogs, read-only notes.

10. **Tests** — API: backfill demotion + Guest normalization, `userCount`,
    locked PATCH, `global_role_id` filter, last-admin guard. Web: roles page
    rows/counts render, add/remove flows, permissions dialog read-only vs
    editable. `bun run check` green.

## Risks

- Visibility regression for existing users with `globalRoleId = NULL`: they
  drop from Member's five modules to Guest's none. Accepted explicitly
  (guest is the floor); the legacy default's explicit assignees are
  preserved by the in-place demotion; seed assigns Member.
- Promote-to-admin from the roles page is privilege escalation by design;
  it reuses the existing admin-gated PATCH and gains the last-admin guard.
- `userCount` for the default role must bucket `NULL` correctly or the
  Guest count lies; covered by a dedicated test.

## Scope

In: items above. Out: project-level roles, module-gate middleware logic,
the per-row role select on `/admin/users` (kept as-is), groups feature,
admin self-management semantics (self-PATCH stays forbidden).

## Alternatives

- Real `global_roles` row for Admin — rejected: admins bypass module
  checks, so a row's modules would be dead configuration with misleading
  semantics.
- New dedicated membership endpoints (`/global-roles/:id/members`) —
  rejected: `GET /account/users` + `PATCH /account/users/:id` already cover
  list/assign/remove; only a filter param is missing.
