# Project Module

Engineering-project aggregate. A **project** is a container of members, work
orders (issues), procurement records, external contacts, and project files — it
is **not** an [`item`](./item.md) sub-type. Projects own their own tables (like
[`drive`](./drive.md)) and are authorized at the route layer against
`project_members` (capability-based); there are no Zanzibar tuples for projects.

## Members are operators; contacts are metadata

Two distinct concepts:

- **Members** (`project_members`) are **operators** — they can be assigned
  issues and procurement. A member is either a **real** user (`user_id` set) or
  a **virtual** user (own staff with no login account: `user_id` NULL +
  `display_name`). The canonical assignment target is `project_members.id`.
- **Contacts** (`project_contacts`) are **reference metadata** — external
  parties (suppliers, clients, subcontractors). A procurement's supplier
  references a contact of `type='supplier'`. Contacts are never operators and
  are never an assignment target.

Project-scoped visibility is decided in the route handlers against
`project_members` and the caller's role capabilities, not by `parent_item`
inheritance.

## File layout

```text
apps/api/src/modules/project/
  schema.ts               # projects, project_roles, project_members, project_contacts, procurement_categories, tags, project_tags
  project.service.ts      # project + member CRUD, tags, the capability helper contract
  project.roles.ts        # role CRUD + default-role seeding + capability parsing
  project.contacts.ts     # external-contact CRUD
  project.categories.ts   # procurement-category CRUD
  project.routes.ts       # /api/projects/... and /api/tags
  project.backup.ts       # backup contribution
  index.ts                # route export + backup registration
  project.service.test.ts
```

## Database

| Table                    | Purpose |
| ------------------------ | ------- |
| `projects`               | Project aggregate (basic fields only). `id` (ULID, internal), `short_id` (nanoid, the **sole external identifier**), `code` (unique), `name`, `status` (`active`/`archived`), `description`, `creator_id`, `version`, `deleted_at`, `updated_at`. |
| `project_roles`          | User-defined roles, per project. `id`, `project_id`, `name`, `capabilities` (JSON `string[]` over `PROJECT_CAPABILITIES`), `is_system` (the seeded "Project Manager" role: undeletable, full capabilities), timestamps. |
| `project_members`        | Operators. `id` (nanoid — **the assignment target**), `project_id`, `user_id` (NULL ⇒ virtual member), `display_name` (virtual), `role_id` → `project_roles`, `title` (job title / trade, display only), timestamps. Unique on `(project_id, user_id)` (multiple NULL `user_id` allowed ⇒ many virtual members). |
| `project_contacts`       | External parties (metadata). `id`, `project_id`, `type` (`supplier`/`client`/`subcontractor`/`other`), `name`, `contact_person`, `phone`, `email`, `address`, `tax_id`, `rating`, `status` (`active`/`inactive`), `note`, timestamps. |
| `procurement_categories` | Procurement classification, per project (flat). `id`, `project_id`, `name`, `code`, `description`, timestamps. |
| `tags`                   | Global, user-defined tag vocabulary. `id`, `name` (unique), timestamps. |
| `project_tags`           | Project ↔ tag many-to-many. PK `(project_id, tag_id)`. |

### Roles and capabilities

`PROJECT_CAPABILITIES`: `project.manage`, `members.manage`, `roles.manage`,
`contacts.manage`, `categories.manage`, `procurement.view`,
`procurement.manage`, `issue.manage`. Each project seeds two roles on creation:
**Project Manager** (`is_system=1`, all capabilities — the creator gets it) and
**Member** (no capabilities). Route gates check capabilities, not role names.

### Virtual members

A member with no `user_id` represents own staff without a login account; it
carries a `display_name` and can be assigned work. **Promotion** to a real user
is an in-place update: set `user_id`; the member keeps its `id`, so existing
assignments survive.

### Identifier exposure

`short_id` is the only project identifier crossing the API boundary. The
internal ULID `id` is never returned — responses map through `composeProject` /
`composeMember`. The detail endpoint additionally returns the caller's effective
`capabilities` for UI gating.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`. `:id` is
the project `short_id`. See [api-routes.md](../reference/api-routes.md) for the
full generated list (projects, members, roles, contacts, procurement-categories,
`/api/tags`).

Highlights:

- `GET /api/projects` — list; admins see all, others only their projects.
  Filters: `status`, `tagId`, `page`, `limit`. Archived projects are excluded
  unless `status=archived` is requested.
- `POST /api/projects` — **admin only**; creator becomes the Project Manager
  member. Body: `{ name, code?, description?, status?, tags? }`.
- `GET/PATCH/DELETE /api/projects/:id` — read (member), update/delete
  (`project.manage`).
- `/api/projects/:id/members` — `members.manage`.
- `/api/projects/:id/roles` — `roles.manage`.
- `/api/projects/:id/contacts` — `contacts.manage` (read: any member).
- `/api/projects/:id/procurement-categories` — `categories.manage` (read: any
  member).
- `GET /api/tags` — global tag vocabulary (any authenticated user).

## Permissions (fail-closed)

| Surface | Rule |
| ------- | ---- |
| Create project | `adminRequired`. |
| Read project / list members / list roles / list contacts / list categories | Project member; non-member ⇒ 404 (membership not leaked). |
| Project edit / delete | `project.manage`. |
| Member management | `members.manage`. |
| Role management | `roles.manage`. |
| Contact management | `contacts.manage`. |
| Category management | `categories.manage`. |
| Procurement read / write | `procurement.view` / `procurement.manage` — see [`procurement`](./procurement.md). |
| Project files | Any project member (editor-equivalent) via the drive capability branch. |

**App-admin bypass.** A user with `role = 'admin'` bypasses every project
membership/capability check — they hold the full capability set on every
project. This prevents lock-out when a project loses its last managing member.
The bypass lives in each route gate (`requireProject`, the procurement and
project-issue gates, the drive project owner resolver). The seeded
"Project Manager" role is `is_system` (undeletable, capabilities locked to the
full set) as a second guard. The frontend mirrors the bypass
(`computeCapabilities` grants admins everything).

## Public service helpers (cross-module contract)

Imported by `issue`, `procurement`, and `drive`. `projectId` is the **internal
ULID**; callers translate an inbound `short_id` via `resolveProjectId`.

| Helper | Purpose |
| ------ | ------- |
| `resolveProjectId(db, shortId)` | shortId → ULID (excludes soft-deleted), else `null`. |
| `isMember(db, projectId, userId)` | Membership predicate (real users only). |
| `getMemberCapabilities(db, projectId, userId)` | `Set<ProjectCapability>` for the member's role, or `null` when not a member. |
| `hasCapability(db, projectId, userId, cap)` | Convenience over the above. |
| `resolveAssignableMember(db, projectId, memberId)` | Validate a `project_members.id` belongs to the project; returns `{ id, userId }` or `null`. |

## Project files (drive `project` ownerType)

Project files are ordinary [`drive`](./drive.md) entries with
`owner_type='project'`, `owner_id=<projects.id>` (addressed by `short_id` at the
API boundary). The drive capability resolver grants any project member
editor-equivalent capabilities; non-members get nothing. The project file
"root" is virtual.

## Assignment model

Issues and procurement assign to `project_members.id`. When the target is a
**real** member, the sub-type also writes the `item:X#assignee@user:Y` tuple so
item-assignee semantics and "my work" lookups keep working; **virtual** members
get only the `assignee_member_id` column (no user tuple, since they have no
`users.id`).

## Events (design only — not implemented)

Service-layer seams are reserved for project event flow; nothing is wired.
Deferred to a future global notification / event module. Outbound emission
points are project mutations (assignment, status change); an inbound webhook
would attribute changes to a service actor.

## Audit

Project and member mutations emit per-action audit events with
`resourceType: 'project'`, `resourceId: <short_id>`.

## Backup

`projectBackupContribution` — tables `projects`, `project_roles`,
`project_members`, `project_contacts`, `procurement_categories`, `tags`,
`project_tags` (parents before children); deps `["users"]`.

## Out of scope

- Project hierarchy / nesting — projects are flat.
- Field-level visibility — capabilities are module-level, not per-field.
- Event implementation (see above) and any external-system integration.
