# HR Module

HR section with three sub-modules (access owned by the group-based module
visibility gate — see [Routes](#routes)):

- **Colleagues** — internal staff members, each linked to exactly one
  existing `users` row, real or virtual (`users.isVirtual = true`). The list
  opens the shared `ResizableDrawer` for create / view / edit, showing a full
  employee profile (personal, contact, emergency contacts, employment,
  payment) and a personal-document area that uploads multiple files
  (passport, certificates, …).
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

FEAT-036 / UI-026 page additions: the colleague form gains a Salary section
(标准月薪 + 币种); the Approvals page adds 申请时间 / 裁决时间 columns and a full
reason + decision-note detail view (approve/reject hidden for non-admins); the
Payroll page adds a colleague filter, a 发放时间 column, a per-currency net
summary fed by `meta.totals`, thousands-separated money (the shared
`formatMoney` helper in `shared/lib/format.ts`), and an admin-only 生成本月薪资
one-click generate button (mark-paid and generate are hidden for non-admins).

## Database

Three tables — see [`reference/database.md`](../reference/database.md#hr)
for fields:

- `hr_colleagues`: `user_id` is `NOT NULL UNIQUE` and references
  `users.id ON DELETE RESTRICT`, so at most one colleague row exists per
  user and colleague records never silently disappear when a (virtual) user
  is deleted. Profile columns (all nullable): dates `birthday` / `hire_date`
  / `probation_end_date` / `contract_end_date`; enums `gender` /
  `employment_type`; text `nationality` / `personal_phone` /
  `personal_email` / `address` / `work_location`; the standing salary
  `salary_amount` (integer minor units) and `salary_currency` (3-letter code),
  both nullable and consumed by the payroll generator below; and two JSON
  columns — `payment_info` (`[{label,value}]`) and `emergency_contacts`
  (`[{name,relation,phone,email,address}]`). National-ID / passport numbers
  are NOT stored as fields — they live as uploaded documents. The salary
  columns were added in migration `0002_dazzling_raza.sql` (FEAT-036).
- Personal documents reuse the file module's generic `file_references`
  registry with `owner_type = 'hr_colleague_document'` and
  `owner_id = <hr_colleagues.id>` — no per-module attachment table; backups
  cover them through the file module's own contribution.
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

Mounted under `protectedRoutes`. Access is owned by the group-based module
visibility gate (PLAN-076, FEAT-032): `hr` is a registered module key, users
in no `hr`-granting group get 404, and admins always bypass. In practice HR
stays admin-only until an admin grants the `hr` module to a group.

Most routes carry no extra `adminRequired` — module access is enough. The
**governance** actions are the exception (FEAT-036): deciding an approval
(`POST /hr/approvals/:id/decision`), generating a month's payroll
(`POST /hr/payroll/generate`), and marking a payroll record paid
(`PATCH /hr/payroll/:id` with `status:"paid"`) each additionally require admin.
A non-admin with the `hr` module retains read and non-governance edits but
gets 403 on these.

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/colleagues` | Paginated list with optional `q` (matches user name, username, or colleague code) and `status` (`active` \| `archived`) filters. Rows carry joined user display data (`name`, `username`, `isVirtual`, `status`). |
| POST | `/api/hr/colleagues` | Creates a colleague linked to an existing **active** real or virtual user. Missing user → 404, inactive user → 400 `USER_NOT_ACTIVE`, already linked → 409 `CONFLICT`. |
| PATCH | `/api/hr/colleagues/:id` | Updates `userId`, `status`, or any profile field (`code`, `title`, `department`, `notes`, the date/enum/text columns, `paymentInfo`, `emergencyContacts`). Re-linking validates the new user the same way as create. |
| DELETE | `/api/hr/colleagues/:id` | Archives (sets `status = 'archived'`); never hard-deletes. Idempotent. |
| POST | `/api/hr/colleagues/:id/attachments` | Uploads a personal document (`multipart/form-data`, field `file`). Missing colleague → 404. |
| GET | `/api/hr/colleagues/:id/attachments` | Lists the colleague's documents. |
| GET | `/api/hr/colleagues/:id/attachments/:aid` | Downloads a document (`?inline=true` to preview). |
| DELETE | `/api/hr/colleagues/:id/attachments/:aid` | Removes a document — admin or the uploader only (else 403). |

The user picker on the frontend uses the existing
`/api/account/assignable-users` source (active real and virtual users).

### Approvals

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/approvals` | Paginated list, newest-first (`created_at` desc), with optional `q` (matches title, applicant name/username), `status`, and `type` filters. Rows carry joined applicant display data and the decider name. |
| POST | `/api/hr/approvals` | Files a request for an existing **active** colleague (404 missing, 400 archived). |
| PATCH | `/api/hr/approvals/:id` | Edits a **pending** request; decided records → 409 `APPROVAL_DECIDED`. |
| POST | `/api/hr/approvals/:id/decision` | **Admin-only.** One-way decision: `{ status: approved \| rejected, note? }`. Stamps `decided_by` / `decided_at`; re-deciding → 409. |
| DELETE | `/api/hr/approvals/:id` | Withdraws a **pending** request; decided records → 409. |

### Payroll

| Method | Path | Description |
|---|---|---|
| GET | `/api/hr/payroll` | Paginated list with optional `colleagueId`, `period` (`YYYY-MM`), and `status` filters, newest period first. `meta.totals` carries `[{ currency, net }]` — net summed over the **entire filtered set** (not just the page) for a per-currency summary. |
| POST | `/api/hr/payroll/generate` | **Admin-only.** One-click monthly generation: body `{ period: "YYYY-MM" }`; for each **active** colleague with a salary set and no record for the period, inserts a `pending` record (`base = net = salaryAmount`, `bonus = deduction = 0`). Idempotent — already-present colleagues are skipped; returns `{ created, skipped }`; never marks anything paid. |
| POST | `/api/hr/payroll` | Creates a record for an active colleague. Duplicate `(colleague, period)` → 409; net < 0 → 400 `NEGATIVE_NET`. |
| PATCH | `/api/hr/payroll/:id` | Edits a **pending** record (net recomputed); `status: "paid"` marks it paid and stamps `paid_at` — **marking paid is admin-only** (403 otherwise), plain field edits stay module-gated. Paid records → 409 `PAYROLL_PAID`; reverting to pending is rejected (422). |
| DELETE | `/api/hr/payroll/:id` | Deletes a **pending** record; paid records → 409. |

## Out of scope

- Employee self-service submission and multi-step approval chains — HR
  stays effectively admin-only until a group is granted the `hr` module.
- Payroll calculation rules and currency conversion — amounts are entered
  manually; the net amount is simple arithmetic.
- An HR-specific capability model — visibility is all-or-nothing via the
  `hr` module key on groups (PLAN-076, FEAT-032); per-capability levels inside
  HR do not exist.
