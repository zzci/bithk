# Project Module

A **project** is a **core record plus a set of mounted sections**. The core owns
identity and metadata, the sub-project hierarchy, and the permission anchor
(roles + members). Everything else — issues, procurement, files, and the three
maritime surfaces — is a *section*: an independent sub-module that owns its own
tables, routes, capabilities, backup contribution and UI tab, and that a project
either mounts or does not.

There is **no project `type` column and no ship table**: a project that mounts
`ship-profile` *is* a ship. See
[ADR-015](../decisions/015-projects-as-sections.md) for the decision, the
registry contract and its binding limits.

Projects own their own tables (like [`drive`](./drive.md)) and are authorized at
the route layer against `project_members` (capability-based); there are no
Zanzibar tuples for projects. Project tags are **not** owned here — the
vocabulary and the `tags_refs` assignment table both live in the shared
[`tag`](./tag.md) module (tag `type = 'project'`).

## Sections

### The mount table

`project_sections` is the single source of truth for what a project is. A row
present means the section is mounted; its absence means it is not. There is no
`enabled` flag and no soft "disabled" state.

| Section key    | Owning module | Tables it brings | Provisioned on mount |
| -------------- | ------------- | ---------------- | -------------------- |
| `issues`       | [`issue`](./issue.md) | `issue_details`, `issue_references` | — (starts empty) |
| `procurement`  | [`procurement`](./procurement.md) | `procurement_details`, `procurement_categories` | Copies the global procurement-category template |
| `files`        | [`drive`](./drive.md) | `drive_entries` rows with `owner_type='project'` | — (starts with an empty root) |
| `ship-profile` | [`ship`](./ship.md) | `ship_profiles` | Inserts the profile row (hull number + particulars) |
| `equipment`    | [`ship`](./ship.md) | `ship_equipment`, `ship_equipment_categories` | Copies the global equipment-category template |
| `worklist`     | [`ship`](./ship.md) | `worklists` (project-scoped rows) | — (starts empty) |

### The registry

`apps/api/src/modules/project/section.registry.ts` is a **static** list. Each
section registers itself from its OWNING module's barrel as an import-time side
effect ([ADR-009](../decisions/009-module-barrels.md)), so the project module
never imports the modules it hosts and the registry file stays dependency-free
(types only).

`ProjectSectionDefinition` has four fields and no more:

| Field | Purpose |
| ----- | ------- |
| `key` | Mount key. Also the `?section=` filter value and the `sections/:key` path segment. |
| `capabilities?` | Capabilities this section owns; compile-time checked against `PROJECT_CAPABILITIES`. |
| `provision?` | Copy-on-mount hook, run **inside** the transaction that writes the mount row. |
| `hasData?` | Guards unmount: while it resolves true the section still holds data. |

The non-goals are binding, not "not yet": no runtime/dynamic loading, no
per-section config JSON, no section versioning, no per-section membership or
roles, no permission inheritance parent → child, no hierarchies deeper than one
level. See [ADR-015](../decisions/015-projects-as-sections.md) § "The registry
contract, and its deliberate limits".

### Presets

Presets are a static map (`PROJECT_PRESETS`), not a table. `preset` is a field
on the create body; it defaults to `general`.

| Preset | Sections mounted, in tab order |
| ------ | ------------------------------- |
| `general` (default) | `issues`, `procurement`, `files` |
| `ship` | `issues`, `procurement`, `files`, `ship-profile`, `equipment`, `worklist` |

"Ship" is a create-time preset, nothing more. A `general` project can become a
ship later by mounting the three maritime sections, and it will be seeded
identically (see below).

### Provisioning — on create AND on late mount

`provision(tx, projectId, ctx)` runs on **both** mount paths:

- **at create**, in the same transaction as the `projects` row, in preset order;
- **at `mountSection`**, in the same transaction as the mount row.

That is what keeps the invariant "section mounted" == "the rows it seeds exist"
true on both paths. A hook that throws rolls the mount row back with it — there
is no half-mounted section. Mounting an already-mounted section is a no-op and
does not re-provision.

Provision hooks are **synchronous by contract**. bun:sqlite transactions are
synchronous, so a hook that deferred a write past an `await` would land after
COMMIT. The declared return type is spelled `void | undefined` (not a bare
`void`) precisely so an `async` hook is a compile error, and `provisionSections`
throws at runtime if a hook returns a `Promise`. Rationale in
[ADR-015](../decisions/015-projects-as-sections.md).

`ctx.sectionData` carries the raw per-section create payload
(`sectionData[<key>]` from `POST /projects`, or the `sectionData` body of
`PUT .../sections/:key`). The project module hands it through **untyped**; each
section validates its own slice inside its own hook, so adding a section never
edits the project module.

### `requireSection` — fail-closed

Section routes live in their owning modules and wrap themselves in
`requireSection(key)` (`section.middleware.ts`). A missing project, a
soft-deleted one and an unmounted section all answer the same 404, per
[ADR-003](../decisions/003-fail-closed-404-existence-policy.md) — a caller
cannot probe which projects have which sections. Sections keep their own
per-route capability gates *on top of* the section gate.

The `files` section is the one exception in form, not policy: the project files
surface is addressed by owner scope
(`ownerType=project&ownerId=<shortId>`) rather than a route param, so
`drive.routes.ts` calls `hasSection` directly in its project-owner resolver —
same fail-closed 404.

### Unmounting

`DELETE /projects/:id/sections/:key` refuses with `409 SECTION_NOT_EMPTY` while
the section's `hasData` predicate holds. There is no data loss on unmount.
Unmounting a section that is not mounted is a no-op.

## Capabilities by section

`PROJECT_CAPABILITIES` stays ONE flat literal — roles validate their JSON array
against it — and the sibling `CAPABILITY_SECTION` map tags each entry with its
owning section. The fold added **no new capabilities**.

| Section | Capabilities |
| ------- | ------------ |
| `issues` | `issue.view`, `issue.comment`, `issue.manage` |
| `procurement` | `procurement.view`, `procurement.comment`, `procurement.manage`, `categories.manage` |
| `files` | `files.view`, `files.manage` |
| `core` (pseudo-section; every project) | `members.manage`, `roles.manage`, `project.manage` |

`core` is not mountable and has no `project_sections` row — it names the core
record so the project-admin capabilities have somewhere to map. The three
maritime sections declare **no** capabilities: they keep the gating they already
had (any member reads, `project.manage` writes), so the fold needed no role
migration.

The Roles editor groups capabilities by section and hides the ones whose section
the project has not mounted (`isCapabilityOffered`). The web mirror of
`CAPABILITY_SECTION` lives in
`apps/web/src/app/routes/_app/projects/-project-sections.ts` and a parity test
compares the two maps key for key.

## Sub-projects

`projects.parent_id` is a self-FK, **one level only**: a project that has a
parent cannot itself become a parent, and a project that has children cannot be
given one. The rule is enforced in the service, not by the DB. The FK carries
only `ON DELETE SET NULL`, so a hard-deleted parent unlinks its children rather
than taking them with it, and `softDeleteProject` explicitly unlinks them.

The hierarchy is **core, not a section** — children exist for every project on
the API. There is **no permission inheritance** across the link: a child keeps
its own members, roles and sections. (The web *tab* is preset-gated on
`ship-profile`, because it replaced the old ship↔project binding surface and a
plain project has no use for it in v1.)

## File layout

```text
apps/api/src/modules/project/
  schema.ts                 # projects, project_sections, project_roles, project_members,
                            # PROJECT_CAPABILITIES + CAPABILITY_SECTION
  section.registry.ts       # the static registry + PROJECT_PRESETS (dependency-free)
  section.service.ts        # sole owner of project_sections reads/writes
  section.middleware.ts     # requireSection(key)
  project.service.ts        # project + member CRUD, hierarchy, cover, tag assignment
  project.roles.ts          # role CRUD + default-role seeding + capability parsing
  project.cover.permission.ts  # project_cover file-permission hook
  project.routes.ts         # /api/projects/..., /api/admin/project-default-cover
  project.backup.ts         # backup contribution
  index.ts                  # route export + backup / search / cover-hook registration
```

## Database

| Table | Purpose |
| ----- | ------- |
| `projects` | Core record. `id` (ULID, internal), `short_id` (nanoid — the **sole external identifier**), `code` (unique, immutable, lowercased), `name`, `status` (`active`/`archived`), `description`, `parent_id` (self-FK, `ON DELETE SET NULL`), `cover_reference_id` (→ `file_references`, `ON DELETE SET NULL`), `creator_id` (→ `users`, **`ON DELETE RESTRICT`** — see [ADR-008](../decisions/008-delete-cascade-semantics.md)), `version`, `deleted_at`, `updated_at`. |
| `project_sections` | Mounted sections. PK `(project_id, key)`; `sort_order` (tab order, stepped by 10 so a later mount can be slotted between two), `created_at`. Index `(key, project_id)` — key-first, so the `?section=` filter subquery rides it as a covering index. `project_id` cascades. |
| `project_roles` | User-defined roles, per project. `capabilities` is a JSON `string[]` over `PROJECT_CAPABILITIES`. `kind` ∈ `owner` \| `guest` \| `null`; `is_system` marks the two undeletable ones. |
| `project_members` | Operators. `id` (nanoid — **the assignment target**), `user_id` (**required**; virtual members are ordinary `users` rows without a login), `role_id` → `project_roles` (`ON DELETE RESTRICT`), `title` (display only). Unique on `(project_id, user_id)`. |

`projects.ship_id` is **gone**. `procurement_categories` and
`global_procurement_categories` moved to the [`procurement`](./procurement.md)
module; the maritime tables live in [`ship`](./ship.md).

### Roles

Five roles are seeded on creation:

| Role | `kind` | `is_system` | Capabilities |
| ---- | ------ | ----------- | ------------ |
| Project Owner | `owner` | 1 | All. The creator gets it. Assignable only by a caller who already holds `project.manage`. |
| Guest | `guest` | 1 | None. Never assignable through the member endpoints — reached only as the member-delete fallback. |
| Reader | — | 0 | `issue.view`, `procurement.view`, `files.view` |
| Commenter | — | 0 | Reader + `issue.comment`, `procurement.comment` |
| Writer | — | 0 | Commenter + `issue.manage`, `procurement.manage`, `files.manage`, `categories.manage` |

Reader / Commenter / Writer are editable presets, not system roles. Route gates
check capabilities, never role names.

### Members are operators

**Members** are **operators** — they can be assigned issues and procurement. The
canonical assignment target is `project_members.id`. Every member maps to a
`users` row (real or virtual); display name comes from the joined user. External
parties are not members: they live in the global [`contact`](./contact.md)
module, and a procurement supplier points at a global contact row.

### Identifier exposure

`short_id` is the only project identifier crossing the API boundary. The
internal ULID is never returned — responses map through `composeProject` /
`composeMember`. The detail endpoint additionally returns the caller's effective
`capabilities`, and both list and detail carry `sections` (mounted keys, in tab
order) for UI gating.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`. `:id` is
the project `short_id`. See [api-routes.md](../reference/api-routes.md) for the
full generated list.

| Method | Path | Access | Notes |
| ------ | ---- | ------ | ----- |
| GET | `/api/projects` | member (admins: all) | Filters: `status`, `q`, `tagIds` (OR), **`section`**, `page`, `limit`. Archived hidden unless `status=archived`. |
| POST | `/api/projects` | **admin** | Body: `{ name, code?, description?, parentId?, preset?, sectionData?, tags? }`. Creator becomes Project Owner. |
| GET | `/api/projects/:id` | member | Detail + caller `capabilities`. |
| PATCH | `/api/projects/:id` | `project.manage` | `code` is immutable. Optional `expectedVersion` optimistic-concurrency guard. |
| DELETE | `/api/projects/:id` | `project.manage` | Soft delete; cascades to the project's issues/procurement items and unlinks sub-projects. |
| PUT | `/api/projects/:id/sections/:key` | `project.manage` | **Mount + provision, one transaction.** Body optional; when present it is `{ "sectionData": { … } }` carrying this section's slice. Answers the full section list in tab order. |
| DELETE | `/api/projects/:id/sections/:key` | `project.manage` | Unmount. `409 SECTION_NOT_EMPTY` while the section holds data. Answers the full section list. |
| GET | `/api/projects/:id/children` | member | Sub-projects. |
| POST | `/api/projects/:id/children` | `project.manage` | Create a sub-project (body = create body minus `parentId`). |
| PUT / DELETE | `/api/projects/:id/children/:childId` | `project.manage` | Link / unlink. Unlink never deletes the child. |
| — | `/api/projects/:id/members` | `members.manage` (read: member) | |
| — | `/api/projects/:id/roles` | `roles.manage` (read: member) | |
| — | `/api/projects/:id/cover-image` | `project.manage` | Multipart upload / remove. Owner type `project_cover`. |
| — | `/api/admin/project-default-cover` | **admin** | The default cover applied to projects created without one. PAT-scoped to `projects`. |

### The `section` list filter

`?section=<key>` keeps only projects carrying that mount row. It is
**enumerated** against the known section keys, so a typo is a loud 422 rather
than a silently empty list, and it is applied **in SQL before pagination**, so
`total` describes the filtered set. The sidebar's "Ships" entry is exactly
`/projects?section=ship-profile` — a preset link, not a second route tree.

Section sets are **batch-loaded** for a list page in one query
(`loadSectionsForProjects`); never call `listSections` per row.

## Permissions (fail-closed)

| Surface | Rule |
| ------- | ---- |
| Create project | `adminRequired`. |
| Read project / list members / roles / children | Project member; non-member ⇒ 404 (membership not leaked). |
| Project edit / delete / cover / mount / unmount | `project.manage`. |
| Member management | `members.manage`, plus anti-escalation: Guest is never assignable, and the Owner role only by a caller holding `project.manage`. |
| Role management | `roles.manage`. |
| Section surfaces | `requireSection(key)` first (404 when unmounted), then the section's own capability gate. |

**App-admin bypass.** A user with `role = 'admin'` bypasses every project
membership/capability check — they hold the full capability set on every
project, which prevents lock-out when a project loses its last managing member.
The bypass lives in each route gate; the frontend mirrors it
(`computeCapabilities` grants admins everything).

**Module gate wins over membership.** A user who is a project member but whose
groups lack the `projects` module still gets 404 — see
[architecture.md](../architecture.md#authorization-model). Since the fold there
is no separate `ships` module key: `projects` governs the maritime sections too.

## Public service helpers (cross-module contract)

Imported by `issue`, `procurement`, `drive` and `ship`. `projectId` is the
**internal ULID**; callers translate an inbound `short_id` via
`resolveProjectId`.

| Helper | Purpose |
| ------ | ------- |
| `resolveProjectId(db, shortId)` | shortId → ULID (excludes soft-deleted), else `null`. |
| `isMember(db, projectId, userId)` | Membership predicate. |
| `getMemberCapabilities(db, projectId, userId)` | `Set<ProjectCapability>` for the member's role, or `null` when not a member. |
| `hasCapability(db, projectId, userId, cap)` | Convenience over the above. |
| `resolveAssignableMember(db, projectId, memberId)` | Validate a `project_members.id` belongs to the project. |
| `requireSection(key)` | Hono middleware: 404 unless the route's project has `key` mounted. |
| `hasSection(db, projectId, key)` | Predicate form, for surfaces not addressed by a route param. |
| `registerProjectSection(def)` | Registration entry point, called from an owning module's barrel. |

## Delete semantics

`softDeleteProject` stamps `deleted_at`, then in the same transaction:

- **unlinks** sub-projects (`parent_id = NULL`) — children are independent
  projects that merely hung off this one, never cascade-deleted;
- soft-deletes the project's issue and procurement `items` rows and drops their
  `relation_tuples`.

A ship-type project deletes through **this** path. There is no admin-only ship
delete any more.

## Audit

The project module emits **no** audit events today — there is no
`auditFromCtx` call anywhere under `modules/project/`. Project, member, role and
section mutations are therefore unaudited; the sub-types mounted on a project
(`issue`, `procurement`) audit their own actions. Adding project-level audit is
open work, not a regression from the section fold.

## Backup

`projectBackupContribution` — tables `projects`, `project_roles`,
`project_members`, `project_sections` (parents before children); deps
`["users", "tags"]`. `project_sections` carries the rows that give a restored
project its tabs. Project tag assignments live in the shared `tags_refs` table
(owned by [`tag`](./tag.md)), which is why `tags` is a dep.

`ships` is **not** a dep: with `projects.ship_id` gone the ship contribution
depends on `projects` one way only, so the old cycle is dead. The two
procurement-category tables moved to the [`procurement`](./procurement.md)
contribution. See [backup.md](./backup.md).

## Out of scope

- Everything in the [ADR-015](../decisions/015-projects-as-sections.md)
  non-goals list — most importantly dynamic section loading, per-section config,
  per-section membership, and hierarchies deeper than one level.
- Field-level visibility — capabilities are section-level, not per-field.
- Project events / outbound notifications: service-layer seams exist, nothing is
  wired. Deferred to a future global notification module.
