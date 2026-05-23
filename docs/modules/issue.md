# Issue Module

Personal issue tracking. **Built on top of the [`item`](./item.md) base**:
common metadata (title / status / soft-delete / version / comments /
attachments / owner+assignee policy tuples) lives in the base; this module
owns one detail table and the routes that surface "issues" as a domain
concept.

## File layout

```text
apps/api/src/modules/issue/
  schema.ts            # issue_details ONLY (item + comments + attachments live in mod-item / mod-file)
  issue.service.ts     # thin facade over items / issue_details / policy
  issue.routes.ts      # /api/issues/...
  issue.backup.ts      # backup contribution (issue_details only)
  index.ts             # backup registration
  issue.test.ts
```

## Database

| Table           | Purpose                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `issue_details` | Per-issue business fields keyed off `item_id` (1:1 with `items` rows where `type='issue'`). Columns: `description`, `priority`, `due_date`, and the nullable project dimension `project_id` (FK → `projects`) + `assignee_member_id` (FK → `project_members`). |

### Personal vs project issues

`project_id` is nullable. `NULL` = a **personal issue** — the original
behavior, unchanged: user-tuple assignment, creator/assignee route checks,
and exclusion from project listings. A non-null `project_id` makes it a
**project work order**: assignment targets a `project_members.id`
(`assignee_member_id`); when the member is internal the existing
`item:X#assignee@user:Y` tuple is also written, so "my work" lookups keep
working, while external members get only the column. Project work orders are
authorized by project membership (see [project.md](project.md)) and are kept
out of the personal `/api/issues` + "my issues" lists.

What does **not** live in this module:

| Concern                         | Where it lives                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`, `short_id`, `title`, `status`, `creator_id`, `version`, `deleted_at`, `updated_at` | `items` (the base). Soft delete via `items.deleted_at`. |
| Assignee                        | `relation_tuples` namespace `item`, relation `assignee` — single source of truth.                       |
| Comments                        | `item_comments` (flat reply model, `is_internal` flag).                                                 |
| Attachments                     | `file_references` rows with `owner_type='item_attachment'`, `owner_id=<items.id>`; bytes in `files`.    |
| Sharing / additional viewers    | Future: `relation_tuples` with relation `viewer` / `editor` — same shape `document` uses.                |

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`.

| Method | Path                                          | Description                                                                                                |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/issues`                                 | Lists issues (admin: all; user: creator OR assignee). Filters: `q` (LIKE on title), `status`, `priority`, `assignee_id`, `creator_id`. |
| POST   | `/api/issues`                                 | Create. Body: `{ title, description?, priority?, assigneeId?, dueDate? }`.                                  |
| GET    | `/api/issues/:id`                             | Detail (`:id` is the 8-char short id).                                                                      |
| PATCH  | `/api/issues/:id`                             | Update. Body fields: any of `{ title, description, status, priority, assigneeId, dueDate }`. Assignees can only update `status`. |
| DELETE | `/api/issues/:id`                             | **Soft delete** — sets `items.deleted_at`, clears policy tuples for the item. |
| GET    | `/api/issues/:id/attachments`                 | List attachments — delegated to `file_references` keyed on `(item_attachment, items.id)`.                    |
| POST   | `/api/issues/:id/attachments`                 | Upload — delegated to `FileService.uploadAndReference`.                                                      |
| GET    | `/api/issues/:id/attachments/:aid`            | Download. `:aid` is `file_references.id`. `inline=true` opts into inline rendering for safe MIME types.       |
| DELETE | `/api/issues/:id/attachments/:aid`            | Release the reference — async GC reclaims the blob.                                                          |
| GET    | `/api/issues/:id/comments`, `POST`, `DELETE /:cid`, and `/:cid/attachments[/:aid]` (CRUD) | Mounted by [`mountItemCommentRoutes`](./item.md#shared-comment--attachment-routes). Internal comments are returned only to admin / creator / assignee. Comment-attachment upload is author-only. |
| GET    | `/api/projects/:projectId/issues` | List a project's work orders (members only; non-member ⇒ 404). Filters: `q`, `status`, `priority`, `page`, `limit`. |
| POST   | `/api/projects/:projectId/issues` | Create a project work order (members only). Body adds `assigneeMemberId` (a `project_members.id`) in place of `assigneeId`. |

## Permissions

The route layer composes three signals:

1. **Creator** — `items.creator_id === user.id`. Full edit rights.
2. **Assignee** — `relation_tuples` row with `relation='assignee'`. Can view + change `status` only.
3. **Admin** — `user.role === 'admin'`. Bypasses every check.

`updateIssue`'s assignee handling is atomic: when `assigneeId` is set, the
prior `assignee` tuple is deleted and a new one is written in the same
transaction. Passing `assigneeId: null` drops the tuple — the canonical
"no assignee" state is "no tuple".

Soft-delete cascades to **every** `relation_tuples` row keyed off the
item so the dead issue stops appearing in `listMyIssues`.

## Audit

`issue.created`, `issue.assigned`, `issue.status_changed`, `issue.updated`,
`issue.deleted`, `issue.attachment_uploaded`, `issue.attachment_deleted`,
`issue.comment_added`, `issue.comment_deleted`,
`issue.comment_attachment_uploaded`, `issue.comment_attachment_deleted`.

The base never emits audit; the sub-type does — `resourceType: 'issue'`,
`resourceId: <short_id>`.

## Backup

`issue_details` only. The base's `items` / `item_comments` rows and the
`relation_tuples` carrying assignee / owner are restored via the
`items` / `policies` contributions, which `issue_details` depends on.

## Out of scope

- Subtasks, recurring issues, reminders.
- Cross-user sharing beyond the assignee tuple. (Adding `viewer` /
  `editor` tuples is mechanically supported by the base — no schema
  change needed — but the route layer doesn't expose UI for it today.)
