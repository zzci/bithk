# Finance Module

Admin-managed registry of finance colleagues. A colleague is an internal
finance actor linked to exactly one existing `users` row — real or virtual
(`users.isVirtual = true`).

## File layout

```text
apps/api/src/modules/finance/
  schema.ts               # finance_colleagues table
  finance.routes.ts       # /finance/colleagues CRUD routes
  finance.service.ts      # list/create/update/archive + user-link validation
  finance.backup.ts       # backup contribution (deps: users)
  index.ts
```

Frontend: `apps/web/src/app/routes/_app/finance/` (colleagues list page with
search, status filter, create/edit dialog, virtual-user badge, archive),
data layer in `apps/web/src/shared/lib/api/finance.ts`, sidebar entry in
`apps/web/src/app/routes/_app/-finance.nav.ts`.

## Database

One table, `finance_colleagues` — see
[`reference/database.md`](../reference/database.md#finance) for fields.
`user_id` is `NOT NULL UNIQUE` and references `users.id ON DELETE RESTRICT`,
so at most one colleague row exists per user and colleague records never
silently disappear when a (virtual) user is deleted.

The module registers a backup contribution named `finance` with a dependency
on `users`, so backups restore users before colleagues.

## Routes

Mounted under `protectedRoutes`. All routes require admin access.

| Method | Path | Description |
|---|---|---|
| GET | `/api/finance/colleagues` | Paginated list with optional `q` (matches user name, username, or colleague code) and `status` (`active` \| `archived`) filters. Rows carry joined user display data (`name`, `username`, `isVirtual`, `status`). |
| POST | `/api/finance/colleagues` | Creates a colleague linked to an existing **active** real or virtual user. Missing user → 404, inactive user → 400 `USER_NOT_ACTIVE`, already linked → 409 `CONFLICT`. |
| PATCH | `/api/finance/colleagues/:id` | Updates `userId`, `code`, `title`, `department`, `notes`, or `status`. Re-linking validates the new user the same way as create. |
| DELETE | `/api/finance/colleagues/:id` | Archives (sets `status = 'archived'`); never hard-deletes. Idempotent. |

The user picker on the frontend uses the existing
`/api/account/assignable-users` source (active real and virtual users).

## Out of scope

- Payroll, expenses, reimbursements, approval flows, and ledger features.
- A Finance-specific role/capability model — colleague management is
  admin-only in this first pass.
