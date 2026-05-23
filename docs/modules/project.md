# Project Module

Engineering-project aggregate. A **project** is a container of members, work
orders (issues), procurement records, and project files — it is **not** an
[`item`](./item.md) sub-type. Projects own their own tables (like
[`drive`](./drive.md)) and are authorized at the route layer against
`project_members`; there are no Zanzibar tuples for projects.

## Why route-layer authorization (no policy tuples)

External members (suppliers / webhook-driven actors) have no `users.id`, so an
`item:X#assignee@user:Y` tuple cannot represent them. The canonical assignment
target is therefore `project_members.id`, and project-scoped visibility is
decided in the route handlers against `project_members` (the same shape `issue`
uses for its creator/assignee route checks), not by `parent_item` inheritance.

## File layout

```text
apps/api/src/modules/project/
  schema.ts             # projects + project_members
  project.service.ts    # project + member CRUD, plus the public helper contract
  project.routes.ts     # /api/projects/...
  project.backup.ts     # backup contribution (projects, project_members)
  index.ts              # route export + backup registration
  project.service.test.ts
```

## Database

| Table             | Purpose |
| ----------------- | ------- |
| `projects`        | Project aggregate. `id` (ULID, internal), `short_id` (nanoid, the **sole external identifier**), `code` (human-readable, unique), `name`, `status` (`active`/`archived`/`closed`), `description`, `start_date`, `end_date`, `creator_id`, `version`, `deleted_at` (soft delete), `updated_at`. Unique on `short_id` and `code`. |
| `project_members` | One row per member. `id` (nanoid — **the assignment target** for issues/procurement), `project_id`, `member_type` (`internal`/`external`), `role` (`pm`/`member`), `user_id` (internal only), `display_name` / `external_ref` / `supplier_info` (external), `can_view_procurement`, timestamps. Unique on `(project_id, user_id)` — one row per real user per project (SQLite allows many NULL `user_id`, so multiple external members are fine). |

### Single member table

`member_type` distinguishes internal (linked to a real `users` row) from
external (supplier / webhook actor carrying `external_ref` + `supplier_info`).
**Promotion** external → internal is an in-place update: set `user_id` and flip
`member_type` to `internal`; the member keeps its `id`, so existing assignments
survive.

### Identifier exposure

`short_id` is the only project identifier crossing the API boundary (URLs,
response `id`, the drive `ownerId` for project files). The internal ULID `id`
is never returned — route responses map through `composeProject` /
`composeMember`, which also drop `project_id` from member rows (redundant
in-context). User ids (`creator_id`, member `user_id`) are exposed, matching the
rest of the codebase.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`. `:id` is
the project `short_id`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/projects` | List projects. Admins see all; other users see only projects they are a member of. Filters: `status`, `page`, `limit`. |
| POST   | `/api/projects` | Create — **admin only**. The creator is written as a `pm` `internal` member (with `can_view_procurement=1`). Body: `{ code?, name, status?, description?, startDate?, endDate? }`. |
| GET    | `/api/projects/:id` | Detail. Members only; non-member ⇒ 404. |
| PATCH  | `/api/projects/:id` | Update (pm only). Bumps `version`. |
| DELETE | `/api/projects/:id` | Soft delete (pm only) — sets `deleted_at`. |
| GET    | `/api/projects/:id/members` | List members (any member). |
| POST   | `/api/projects/:id/members` | Add member (pm only). |
| PATCH  | `/api/projects/:id/members/:memberId` | Update member (pm only): role, `can_view_procurement`, external fields, or promote external→internal. |
| DELETE | `/api/projects/:id/members/:memberId` | Remove member (pm only). |

## Permissions (fail-closed)

| Surface | Rule |
| ------- | ---- |
| Create project | `adminRequired`. |
| Read project / list members | Project member; non-member surfaces as 404 (membership not leaked). |
| Member management, project edit/delete | `role = pm`. |
| Procurement read | Member **and** (`pm` or `can_view_procurement`) — see [`procurement`](./procurement.md). |
| Project files | Resolved by the drive capability branch against `project_members`. |

**App-admin bypass.** A user with `role = 'admin'` bypasses every project
membership check above — they list, read, and manage (pm-equivalent) every
project, its work orders, procurement, and files, regardless of membership.
This is deliberate: without it, removing a project's last `pm` member would
lock the project out permanently. The bypass lives in each route gate
(`requireProjectAccess`, the procurement and project-issue gates, and the drive
project owner resolvers) and in the drive capability resolver's global-admin
branch; the frontend mirrors it (`computeProjectRole` treats an app admin as
pm-equivalent). Project **read is otherwise member-scoped** — the `GET
/api/projects` list returns only the caller's projects for non-admins.

## Public service helpers (cross-module contract)

Imported by `issue`, `procurement`, and `drive`. `projectId` is the **internal
ULID**; callers translate an inbound `short_id` via `resolveProjectId`.

| Helper | Purpose |
| ------ | ------- |
| `resolveProjectId(db, shortId)` | shortId → ULID (excludes soft-deleted), else `null`. |
| `isMember(db, projectId, userId)` | Membership predicate. |
| `getRole(db, projectId, userId)` | `"pm" \| "member" \| null`. |
| `canViewProcurement(db, projectId, userId)` | `pm` OR member row with the grant. |
| `resolveAssignableMember(db, projectId, memberId)` | Validate a `project_members.id` belongs to the project; returns `{ id, memberType, userId }` or `null`. |

## Project files (drive `project` ownerType)

Project files are ordinary [`drive`](./drive.md) entries with
`owner_type='project'`, `owner_id=<projects.id>` (the internal ULID is stored;
the API addresses them by the project `short_id`, which the drive routes resolve
at the boundary). The drive capability resolver grants `pm` admin-equivalent and
internal `member` editor-equivalent capabilities; non-members get nothing. The
project file "root" is **virtual** (`parentEntryId=""`, like every other owner
type) — no root row is created and none is specially protected.

## Assignment model

Issues and procurement assign to `project_members.id`. When the target is an
**internal** member, the sub-type also writes the existing
`item:X#assignee@user:Y` tuple so item-assignee semantics and "my work"
tuple lookups keep working; **external** members get only the
`assignee_member_id` column (no user tuple).

## Events (design only — not implemented)

This phase reserves service-layer seams for project event flow; nothing is
wired. Implementation is deferred to a future global notification / event
module.

- **Inbound** (external → project): a webhook ingress would key the originating
  actor by `project_members.external_ref`, resolving it to a member to attribute
  the change. The audit actor for an external-driven mutation is the service
  actor (or the PM acting on its behalf), since external members have no
  `users.id` and cannot authenticate.
- **Outbound** (project action → external notification): project mutations
  (assignment, status change) are the natural emission points; an outbound
  dispatcher would fan these to external endpoints.
- **Seam**: keep these emissions behind a single call site in the service layer
  so the future module can subscribe without touching route handlers.

## Audit

Project and member mutations emit per-action audit events with
`resourceType: 'project'`, `resourceId: <short_id>`.

## Backup

`projectBackupContribution` — tables `projects`, `project_members` (parent
before child); deps `["users"]`.

## Out of scope

- Project hierarchy / nesting — projects are flat.
- Field-level visibility — visibility is module-level (the `can_view_procurement`
  grant); there is no per-field gating.
- Event implementation (see above) and any external-system integration.
