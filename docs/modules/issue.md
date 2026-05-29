# Issue Module

Project work-order tracking. **Built on top of the [`item`](./item.md) base**:
common metadata (title / status / soft-delete / version / comments /
attachments / owner+assignee policy tuples) lives in the base; this module
owns one detail table and the routes that surface "issues" as a domain
concept.

Every issue belongs to a project — there is **no personal / global issue**.
The assignment target is a `project_members.id`, and access is derived from
project membership.

## Relationship to the access reference

This module tracks the `/app/zzci/access` issue implementation as its baseline
(CRUD, permissions, audit events, comments, attachments, comment attachments).
The following are **intentional, kept deltas** from that reference — they are
not parity gaps and must not be removed during alignment work:

- **Project ownership (the core delta).** Access exposes a flat global
  `/api/issues`; here every issue is owned by a project, routes are nested under
  `/api/projects/:projectId/issues`, and the assignee is a `project_members.id`
  rather than a user id. Access is gated on project membership (fail-closed
  404).
- **Pin / unpin.** `items.pinned` / `items.pinnedAt` plus
  `POST .../issues/:id/{pin,unpin}` power the project overview pinned area.
  Same edit gate as PATCH (admin, PM, or creator; a status-only assignee may
  not pin).
- **Issue references + ship maintenance orders.** The `issue_references` table
  and its routes attach generic references to an issue; the read-only
  `/api/ships/:shipShortId/maintenance-orders` view lists the issues in a ship's
  bound projects that carry a maintenance-template reference. Access has no
  equivalent.
- **Global search.** `searchIssues` backs the command-palette search; its scope
  mirrors the route membership gate (admins see all, members see their projects'
  issues). It is not part of the issue list UI.

The grouped, Linear-style work-order **list** UI is also an intentional product
choice over the access flat table (see [PLAN-032](../plan/PLAN-032.md)); the
detail/drawer/upload/comment flow follows access.

## File layout

```text
apps/api/src/modules/issue/
  schema.ts            # issue_details ONLY (item + comments + attachments live in mod-item / mod-file)
  issue.service.ts     # thin facade over items / issue_details / policy (+ searchIssues)
  issue.routes.ts      # /api/projects/:projectId/issues/... (+ pin/unpin)
  references.schema.ts # issue_references table
  references.service.ts# generic references + ship maintenance-order queries
  references.routes.ts # /api/issues/:id/references, /api/ships/:id/maintenance-orders
  issue.backup.ts      # backup contribution (issue_details only)
  index.ts             # backup registration
  issue.test.ts
```

## Database

| Table           | Purpose                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `issue_details` | Per-issue business fields keyed off `item_id` (1:1 with `items` rows where `type='issue'`). Columns: `description`, `priority`, `due_date`, the **non-null** `project_id` (FK → `projects`, cascade) and the nullable `assignee_member_id` (FK → `project_members`, set null). Indexed on `project_id`. |

### Project work orders

Every issue is a project work order: `project_id` is `NOT NULL` and assignment
targets a `project_members.id` (`assignee_member_id`). When the assigned member
is an internal user, the base `item:X#assignee@user:Y` tuple is also written so
"my work" lookups keep working; external members get only the column. Issues
are authorized by project membership (see [project.md](project.md)); listing
and access fail closed with a 404 for non-members.

What does **not** live in this module:

| Concern                         | Where it lives                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`, `short_id`, `title`, `status`, `creator_id`, `version`, `deleted_at`, `updated_at` | `items` (the base). Soft delete via `items.deleted_at`. |
| Assignee tuple                  | `relation_tuples` namespace `item`, relation `assignee` (written for internal members only).            |
| Comments                        | `item_comments` (flat reply model, `is_internal` flag).                                                 |
| Attachments                     | `file_references` rows with `owner_type='item_attachment'`, `owner_id=<items.id>`; bytes in `files`.    |

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`. All
issue routes are nested under their owning project; there is no top-level
`/api/issues`.

| Method | Path                                                       | Description                                                                                                |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/:projectId/issues`                          | List a project's work orders (members only; non-member ⇒ 404). Filters: `q` (LIKE on title), `status`, `priority`, `page`, `limit`. |
| POST   | `/api/projects/:projectId/issues`                          | Create (members only). Body: `{ title, description?, status?, priority?, assigneeMemberId?, dueDate? }` — `assigneeMemberId` is a `project_members.id` validated against the project. |
| GET    | `/api/projects/:projectId/issues/:id`                      | Detail (`:id` is the 8-char short id; must belong to the path project).                                    |
| PATCH  | `/api/projects/:projectId/issues/:id`                      | Update. Body: any of `{ title, description, status, priority, assigneeMemberId, dueDate }`. Assignees who are neither PM nor creator can only update `status`. |
| DELETE | `/api/projects/:projectId/issues/:id`                      | **Soft delete** — sets `items.deleted_at`, clears policy tuples for the item. |
| POST   | `/api/projects/:projectId/issues/:id/pin`                  | Pin (admin / PM / creator; status-only assignee forbidden). Powers the project pinned area. **Kept delta — not in access.** |
| POST   | `/api/projects/:projectId/issues/:id/unpin`                | Unpin (same gate as pin). **Kept delta — not in access.**                                                  |
| GET    | `/api/projects/:projectId/issues/:id/attachments`          | List attachments — delegated to `file_references` keyed on `(item_attachment, items.id)`.                  |
| POST   | `/api/projects/:projectId/issues/:id/attachments`          | Upload — delegated to `FileService.uploadAndReference`.                                                     |
| GET    | `/api/projects/:projectId/issues/:id/attachments/:aid`     | Download. `:aid` is `file_references.id`. `inline=true` opts into inline rendering for safe MIME types.     |
| DELETE | `/api/projects/:projectId/issues/:id/attachments/:aid`     | Release the reference — async GC reclaims the blob.                                                         |
| —      | `/api/projects/:projectId/issues/:id/comments[/...]`       | Comment + comment-attachment CRUD mounted by [`mountItemCommentRoutes`](./item.md#shared-comment--attachment-routes) with prefix `/projects/:projectId/issues`. Internal comments are returned only to readers; comment delete is author-or-admin. |
| GET / POST / DELETE | `/api/issues/:issueShortId/references[/:referenceId]` | List / add / remove generic references on an issue (read = any reader; write = editor). **Kept delta — not in access.** |
| GET    | `/api/ships/:shipShortId/maintenance-orders`               | Read-only list of maintenance-template issues across a ship's bound projects; gated by the ship read check (fail-closed 404). **Kept delta — not in access.** |

## Permissions

Access is resolved from the issue's real project membership (the path
`:projectId` is structural — the issue must actually belong to it, else 404).
`resolveProjectIssueAccess` derives:

1. **canEdit** — PM capability on the project, or the issue creator. Full edit + delete.
2. **isAssignee** — the actor is the assigned member. Can view + change `status` only.
3. **canRead** — any project member. Admins bypass every check.

Soft-delete cascades to **every** `relation_tuples` row keyed off the item so
the dead issue stops appearing in listings.

## Audit

`issue.created`, `issue.assigned`, `issue.status_changed`, `issue.updated`,
`issue.deleted`, `issue.attachment_uploaded`, `issue.attachment_deleted`,
`issue.comment_added`, `issue.comment_deleted`,
`issue.comment_attachment_uploaded`, `issue.comment_attachment_deleted`,
`issue.pinned`, `issue.unpinned`, `issue.reference_added`,
`issue.reference_removed`.

The base never emits audit; the sub-type does — `resourceType: 'issue'`,
`resourceId: <short_id>`.

## Backup

`issue_details` only. The base's `items` / `item_comments` rows and the
`relation_tuples` carrying assignee / owner are restored via the
`items` / `policies` contributions, which `issue_details` depends on.

## Out of scope

- Subtasks, recurring issues, reminders.
- Personal / cross-project issues. Every issue is scoped to one project.
