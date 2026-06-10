# HR Module

Admin-managed HR section. Its first sub-module is colleagues: a colleague is
an internal staff member linked to exactly one existing `users` row — real or
virtual (`users.isVirtual = true`). Two more sub-modules — Approvals and
Payroll — are pre-mounted in the UI as placeholders and intentionally
unimplemented.

> Renamed from the `finance` module (FEAT-025): colleagues are an HR concern.
> The table, routes, backup contribution, web routes, and i18n namespace all
> moved from `finance*` to `hr*`.

## File layout

```text
apps/api/src/modules/hr/
  schema.ts          # hr_colleagues table
  hr.routes.ts       # /hr/colleagues CRUD routes
  hr.service.ts      # list/create/update/archive + user-link validation
  hr.backup.ts       # backup contribution (deps: users)
  index.ts
```

Frontend: `apps/web/src/app/routes/_app/hr/` — the `/hr` layout
(`_app/hr.tsx`) owns the admin guard and a tab nav (Colleagues / Approvals /
Payroll, registry in `_app/-hr-tabs.ts`); each tab is a route. Colleagues is
the working list page (search, status filter, create/edit dialog,
virtual-user badge, archive); `approvals` and `payroll` render a shared
placeholder. Data layer in `apps/web/src/shared/lib/api/hr.ts`, sidebar entry
in `apps/web/src/app/routes/_app/-hr.nav.ts`.

## Database

One table, `hr_colleagues` — see
[`reference/database.md`](../reference/database.md#hr) for fields.
`user_id` is `NOT NULL UNIQUE` and references `users.id ON DELETE RESTRICT`,
so at most one colleague row exists per user and colleague records never
silently disappear when a (virtual) user is deleted.

The module registers a backup contribution named `hr` with a dependency on
`users`, so backups restore users before colleagues. Backup archives exported
before the rename (module name `finance`, table `finance_colleagues`) do not
map to the renamed contribution.

## Routes

Mounted under `protectedRoutes`. All routes require admin access.

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/colleagues` | Paginated list with optional `q` (matches user name, username, or colleague code) and `status` (`active` \| `archived`) filters. Rows carry joined user display data (`name`, `username`, `isVirtual`, `status`). |
| POST | `/api/hr/colleagues` | Creates a colleague linked to an existing **active** real or virtual user. Missing user → 404, inactive user → 400 `USER_NOT_ACTIVE`, already linked → 409 `CONFLICT`. |
| PATCH | `/api/hr/colleagues/:id` | Updates `userId`, `code`, `title`, `department`, `notes`, or `status`. Re-linking validates the new user the same way as create. |
| DELETE | `/api/hr/colleagues/:id` | Archives (sets `status = 'archived'`); never hard-deletes. Idempotent. |

The user picker on the frontend uses the existing
`/api/account/assignable-users` source (active real and virtual users).

## Out of scope

- Approvals and payroll functionality — only their routes, tabs, and
  placeholder pages exist.
- An HR-specific role/capability model — colleague management is admin-only
  in this first pass.
