# Procurement Module

Project procurement records. **Built on the [`item`](./item.md) base** (like
[`issue`](./issue.md)): the base owns title / status / version / soft-delete /
comments / attachments / owner+assignee tuples; this module owns one detail
table, the procurement lifecycle, and grant-gated visibility within a project.

## File layout

```text
apps/api/src/modules/procurement/
  schema.ts                 # procurement_details ONLY
  procurement.service.ts    # thin facade over items / procurement_details / policy + status lifecycle
  procurement.routes.ts     # /api/projects/:projectId/procurements/...
  procurement.backup.ts     # backup contribution (procurement_details only)
  index.ts                  # route export + backup registration
  procurement.service.test.ts
```

## Database

| Table | Purpose |
| ----- | ------- |
| `procurement_details` | Per-record fields keyed off `item_id` (1:1 with `items` where `type='procurement'`). Columns: `project_id` (FK → `projects`, cascade), `supplier_member_id` / `assignee_member_id` (FK → `project_members`, set null), `item_name`, `quantity`, `amount` (minor currency unit), `currency`. Index on `project_id`. |

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
| GET    | `/api/projects/:projectId/procurements` | List. Filters: `status`, `page`, `limit`. |
| POST   | `/api/projects/:projectId/procurements` | Create. Body: `{ itemName, title?, status?, supplierMemberId?, assigneeMemberId?, quantity?, amount?, currency? }`. Assignment targets are validated via `resolveAssignableMember`. |
| GET    | `/api/projects/:projectId/procurements/:id` | Detail. |
| PATCH  | `/api/projects/:projectId/procurements/:id` | Update. Bumps `version`. |
| DELETE | `/api/projects/:projectId/procurements/:id` | Soft delete — sets `items.deleted_at`, clears item tuples. |
| POST   | `/api/projects/:projectId/procurements/:id/status` | Change status. Body `{ status }`. Emits `procurement.status_changed`. |
| comments | `.../:id/comments[...]` | Mounted by [`mountItemCommentRoutes`](./item.md#shared-comment--attachment-routes). |

## Permissions (fail-closed)

Every route requires the actor be a **project member AND** (`role = pm` OR the
member's `can_view_procurement` grant). A member lacking the grant is fully
denied — list, detail, and procurement comments all 404/403, not merely hidden
in the UI. Resolution uses `resolveProjectId` + `canViewProcurement` from the
[`project`](./project.md) module.

## Assignment

`supplier_member_id` and `assignee_member_id` are `project_members.id` values
(covering both internal and external members). They are validated against the
project before insert/update; an id from another project is rejected (422).

## Audit

`procurement.status_changed` (carries `from`/`to`), plus the create/update/
delete actions, with `resourceType: 'procurement'`, `resourceId: <short_id>`.

## Backup

`procurementBackupContribution` — table `procurement_details`; deps
`["items", "policies", "projects"]` (the base `items`/tuples and the parent
`projects` rows restore first).

## Out of scope

- A dedicated procurement history table (audit + comments cover it).
- Multi-currency conversion — `amount` is an opaque minor-unit integer paired
  with a `currency` string.
