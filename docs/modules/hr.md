# HR Module

HR section with three sub-modules (access owned by the global-role module
visibility gate — see [Routes](#routes)):

- **Colleagues** — internal staff members, each linked to exactly one
  existing `users` row, real or virtual (`users.isVirtual = true`).
- **Approvals** — approval requests (leave / overtime / business trip /
  other) filed for a colleague with a one-way pending → approved/rejected
  decision flow.
- **Payroll** — per-colleague monthly payroll records with multi-currency
  amounts and a one-way pending → paid transition.

> Renamed from the `finance` module (FEAT-025): colleagues are an HR concern.
> The table, routes, backup contribution, web routes, and i18n namespace all
> moved from `finance*` to `hr*`. Approvals and payroll were implemented in
> FEAT-026 / FEAT-027.

## File layout

```text
apps/api/src/modules/hr/
  schema.ts                 # hr_colleagues, hr_approvals, hr_payroll_records
  hr.routes.ts              # /hr/colleagues routes + sub-router mounts
  hr.service.ts             # colleague list/create/update/archive
  hr.approvals.routes.ts    # /hr/approvals routes
  hr.approvals.service.ts   # approval invariants + decision flow
  hr.payroll.routes.ts      # /hr/payroll routes
  hr.payroll.service.ts     # payroll invariants + net computation
  hr.backup.ts              # backup contribution (deps: users)
  index.ts
```

Frontend: `apps/web/src/app/routes/_app/hr/` — access is gated by the
generic `_app` module guard (`hr` module key); the `/hr` layout
(`_app/hr.tsx`) owns a tab nav (Colleagues / Approvals / Payroll, registry
in `_app/-hr-tabs.ts`); each tab is a route with its own list page, filters,
and create/edit dialogs. Data layers in `apps/web/src/shared/lib/api/hr.ts`,
`hr-approvals.ts`, and `hr-payroll.ts`; sidebar entry in
`apps/web/src/app/routes/_app/-hr.nav.ts`.

## Database

Three tables — see [`reference/database.md`](../reference/database.md#hr)
for fields:

- `hr_colleagues`: `user_id` is `NOT NULL UNIQUE` and references
  `users.id ON DELETE RESTRICT`, so at most one colleague row exists per
  user and colleague records never silently disappear when a (virtual) user
  is deleted.
- `hr_approvals`: `colleague_id` references `hr_colleagues.id ON DELETE
  RESTRICT`; `decided_by` references `users.id ON DELETE SET NULL` so
  deleting the deciding admin never blocks on or erases approval history.
- `hr_payroll_records`: `colleague_id` references `hr_colleagues.id ON
  DELETE RESTRICT`; unique `(colleague_id, period)` enforces one record per
  colleague per month. Amounts are integers in the currency's minor unit;
  `net_amount` is computed server-side (base + bonus − deduction, never
  negative). `currency` is a 3-letter uppercase code validated by format —
  multi-currency without schema changes.

The module registers a backup contribution named `hr` (tables: colleagues,
approvals, payroll) with a dependency on `users`, so backups restore users
before HR rows. Backup archives exported before the rename (module name
`finance`, table `finance_colleagues`) do not map to the renamed
contribution.

## Routes

Mounted under `protectedRoutes`. Access is owned by the global-role module
visibility gate (PLAN-076): `hr` is a registered module key, the default
Member role does not include it, and requests from users whose role lacks it
are answered with 404. In practice HR stays admin-only until an admin grants
the `hr` module to a role; admins always bypass. There is no per-route
`adminRequired` here.

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/colleagues` | Paginated list with optional `q` (matches user name, username, or colleague code) and `status` (`active` \| `archived`) filters. Rows carry joined user display data (`name`, `username`, `isVirtual`, `status`). |
| POST | `/api/hr/colleagues` | Creates a colleague linked to an existing **active** real or virtual user. Missing user → 404, inactive user → 400 `USER_NOT_ACTIVE`, already linked → 409 `CONFLICT`. |
| PATCH | `/api/hr/colleagues/:id` | Updates `userId`, `code`, `title`, `department`, `notes`, or `status`. Re-linking validates the new user the same way as create. |
| DELETE | `/api/hr/colleagues/:id` | Archives (sets `status = 'archived'`); never hard-deletes. Idempotent. |

The user picker on the frontend uses the existing
`/api/account/assignable-users` source (active real and virtual users).

### Approvals

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/approvals` | Paginated list with optional `q` (matches title, applicant name/username), `status`, and `type` filters. Rows carry joined applicant display data and the decider name. |
| POST | `/api/hr/approvals` | Files a request for an existing **active** colleague (404 missing, 400 archived). |
| PATCH | `/api/hr/approvals/:id` | Edits a **pending** request; decided records → 409 `APPROVAL_DECIDED`. |
| POST | `/api/hr/approvals/:id/decision` | One-way decision: `{ status: approved \| rejected, note? }`. Stamps `decided_by` / `decided_at`; re-deciding → 409. |
| DELETE | `/api/hr/approvals/:id` | Withdraws a **pending** request; decided records → 409. |

### Payroll

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/payroll` | Paginated list with optional `colleagueId`, `period` (`YYYY-MM`), and `status` filters, newest period first. |
| POST | `/api/hr/payroll` | Creates a record for an active colleague. Duplicate `(colleague, period)` → 409; net < 0 → 400 `NEGATIVE_NET`. |
| PATCH | `/api/hr/payroll/:id` | Edits a **pending** record (net recomputed); `status: "paid"` marks it paid and stamps `paid_at`. Paid records → 409 `PAYROLL_PAID`; reverting to pending is rejected (422). |
| DELETE | `/api/hr/payroll/:id` | Deletes a **pending** record; paid records → 409. |

## Out of scope

- Employee self-service submission and multi-step approval chains — HR
  stays effectively admin-only until a role is granted the `hr` module.
- Payroll calculation rules and currency conversion — amounts are entered
  manually; the net amount is simple arithmetic.
- An HR-specific capability model — visibility is all-or-nothing via the
  `hr` module key on global roles (PLAN-076); per-capability levels inside
  HR do not exist.
