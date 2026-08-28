# Procurement Module

Project procurement records. **Built on the [`item`](./item.md) base** (like
[`issue`](./issue.md)): the base owns title / status / version / soft-delete /
comments / attachments / owner+assignee tuples; this module owns the detail
table, the category vocabulary, the procurement lifecycle, and grant-gated
visibility within a project.

## The `procurement` project section

This module **owns the `procurement` section** of the [`project`](./project.md)
module ([ADR-015](../decisions/015-projects-as-sections.md)). It registers
itself from its own barrel (`modules/procurement/index.ts`) as an import-time
side effect ([ADR-009](../decisions/009-module-barrels.md)), so the project
module never imports it:

| Registry field | Value |
| -------------- | ----- |
| `key` | `procurement` |
| `capabilities` | `procurement.view`, `procurement.comment`, `procurement.manage`, `categories.manage` |
| `provision` | Copies the global category template into the project's own set |
| `hasData` | Has procurements **or** has categories — either half blocks an unmount |

`procurement` is in **both** presets (`general` and `ship`), so a project has it
unless it was explicitly unmounted.

Every route is wrapped in `requireSection("procurement")` — a project without
the section mounted answers a fail-closed 404
([ADR-003](../decisions/003-fail-closed-404-existence-policy.md)), for the list,
the detail, and procurement comments alike.

### The category tables moved here

`categories.manage` maps to the `procurement` section, not to project core:
procurement categories are procurement-domain data. Both category tables
therefore moved out of `project/schema.ts` into this module, and the two
`/global-procurement-categories` + `/projects/:id/procurement-categories` route
groups came with them.

The moved routes deliberately kept `tags: ["projects"]` in their OpenAPI
metadata — this was a **re-home, not a retag**, so the generated API grouping
and any client keyed on that tag are unchanged.

### Copy-on-create provision

`seedProjectCategoriesTx` snapshots every `global_procurement_categories` row
into the project's own `procurement_categories`. Later edits to the global
template never touch an existing project, and per-project edits stay
independent. It is the copy that used to live inside `createProjectTx`.

The hook is **synchronous by contract** — bun:sqlite transactions are, so a
write deferred past an `await` would land after COMMIT. It runs on the
create-time preset path **and** on a later `mountSection`, so a project that
mounts `procurement` late gets the same seeded set.

## File layout

```text
apps/api/src/modules/procurement/
  schema.ts                        # procurement_details, procurement_categories,
                                   # global_procurement_categories
  procurement.service.ts           # thin facade over items / procurement_details / policy + status lifecycle
  procurement.categories.ts        # per-project category CRUD + hasProjectCategories
  procurement.global-categories.ts # global template CRUD + seedProjectCategoriesTx (sync provision)
  procurement.routes.ts            # /api/projects/:projectId/procurements/...
  procurement.category.routes.ts   # /api/global-procurement-categories,
                                   # /api/projects/:id/procurement-categories
  procurement.backup.ts            # backup contribution
  index.ts                         # route export + backup + registerProjectSection
```

## Database

| Table | Purpose |
| ----- | ------- |
| `procurement_details` | Per-record fields keyed off `item_id` (1:1 with `items` where `type='procurement'`). Columns: `project_id` (FK → `projects`, cascade), `supplier_id` (FK → `contacts`, set null — the counterparty, **not** an operator), `category_id` (FK → `procurement_categories`, set null), `assignee_member_id` (FK → `project_members`, set null — the responsible operator), `item_name`, `quantity`, `amount` (minor currency unit), `currency`. Index on `project_id`. |
| `procurement_categories` | Procurement classification, per project (flat). `id`, `project_id` (FK → `projects`, cascade), `name`, `code`, `description`, timestamps. Index on `project_id`. Seeded from the global template when the section is provisioned. |
| `global_procurement_categories` | Admin-maintained template: the per-project shape minus `project_id`. Copy source only — nothing references it at runtime. |

The procurement lifecycle status lives on `items.status`:
`draft → requested → ordered → received → closed`. The allowed set is validated
at the zod boundary and defensively in `changeStatus`.

## Event log (comment-based)

There is **no** separate history table. A status transition emits a
`procurement.status_changed` audit row (who / when / from → to); members attach
context through ordinary `item_comments`. This matches the `item` doctrine:
audit already answers "who did what when".

## Routes

Mounted under `protectedRoutes`; `authRequired`. `:projectId` = project
`short_id`, `:id` = procurement `short_id`. The procurement `projectId` in
responses is the project `short_id` (never the internal ULID).

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/projects/:projectId/procurements` | List. Filters: `status`, `categoryId`, `page`, `limit`. |
| POST   | `/api/projects/:projectId/procurements` | Create. Body: `{ itemName, title?, status?, supplierId?, categoryId?, assigneeMemberId?, quantity?, amount?, currency? }`. The `supplierId` reference is validated against the global contact directory; `categoryId` and `assigneeMemberId` are validated against the project before insert. |
| GET    | `/api/projects/:projectId/procurements/:id` | Detail. |
| PATCH  | `/api/projects/:projectId/procurements/:id` | Update. Bumps `version`. |
| DELETE | `/api/projects/:projectId/procurements/:id` | Soft delete — sets `items.deleted_at`, clears item tuples. |
| POST   | `/api/projects/:projectId/procurements/:id/status` | Change status. Body `{ status }`. Emits `procurement.status_changed`. |
| comments | `.../:id/comments[...]` | Mounted by [`mountItemCommentRoutes`](./item.md#shared-comment--attachment-routes). |

Category routes (owned by this module since the section fold; `:id` is the
project `short_id`):

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/projects/:id/procurement-categories` | List the project's categories (any member). |
| POST / PATCH / DELETE | `/api/projects/:id/procurement-categories[/:categoryId]` | Maintain them (`categories.manage`). |
| GET    | `/api/global-procurement-categories` | The admin-maintained template (**admin**). |
| POST / PATCH / DELETE | `/api/global-procurement-categories[/:id]` | Maintain the template (**admin**). Edits never propagate to existing projects. |

## Permissions (fail-closed)

Every route requires the actor be a **project member AND** hold the
`procurement.view` capability; mutations (create / update / delete / status)
additionally require `procurement.manage`. A member lacking the capability is
fully denied — list, detail, and procurement comments all surface as 404 (not
merely hidden in the UI), so neither the project's existence nor its
procurement leaks. App admins bypass membership and capabilities. Resolution
uses `resolveProjectId` + `hasCapability(db, projectId, actorId, "procurement.view"|"procurement.manage")`
from the [`project`](./project.md) module.

## References

- `supplier_id` → `contacts`: the order counterparty, metadata only — not an
  operator. It may reference any existing global contact; there is no project
  scoping or contact type enum.
- `assignee_member_id` → `project_members`: the responsible operator (internal
  or external member).
- `category_id` → `procurement_categories`: classifies the line item.

The category and assignee references are project-scoped and reject ids from
another project. The supplier reference is global and only requires that the
contact exists.

## Audit

`procurement.status_changed` (carries `from`/`to`), plus the create/update/
delete actions, with `resourceType: 'procurement'`, `resourceId: <short_id>`.

## Backup

`procurementBackupContribution` — tables `global_procurement_categories`,
`procurement_categories`, `procurement_details` (the global vocabulary leads —
no outbound FK — then the per-project copies, then the procurements that
reference them, so per-module insert order alone satisfies the FK chain); deps
`["items", "policies", "projects"]` (the base `items`/tuples and the parent
`projects` rows restore first).

The two category tables moved here from the `projects` contribution in the
section fold. The importer maps rows by table name, so the move is transparent
for post-fold archives; pre-fold archives are refused outright by the format
version gate. See [backup.md](./backup.md).

## Out of scope

- A dedicated procurement history table (audit + comments cover it).
- Nested / hierarchical categories — the per-project set is flat.
- Multi-currency conversion — `amount` is an opaque minor-unit integer paired
  with a `currency` string.
