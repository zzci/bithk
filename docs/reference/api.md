# API

> Examples below omit any `BASE_PATH` prefix. When `BASE_PATH=/app` is set,
> the API mounts under `/app/api/...`; with `BASE_PATH` unset (default)
> the API is at `/api/...`.

This document is the narrative API surface — request bodies, response
shapes, access rules. The flat per-route index is generated as
[`api-routes.md`](api-routes.md) (CI fails if it drifts from the Hono
routes table); the tables below are hand-maintained alongside it.

## Response shape

Most JSON endpoints return:

```json
{
  "success": true,
  "data": {}
}
```

Paginated endpoints add `meta`:

```json
{
  "success": true,
  "data": [],
  "meta": { "total": 0, "page": 1, "limit": 20 }
}
```

Errors use the shared error handler:

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Resource not found" }
}
```

## Access levels

| Level         | Meaning                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Public        | No session required.                                                                                      |
| Authenticated | Requires a valid session cookie.                                                                          |
| Admin         | Requires a valid session and `user.role === "admin"`.                                                     |
| Service Token | Requires a scoped bearer (`SERVICE_TOKEN_METRICS` for `/api/metrics`, `SERVICE_TOKEN_BACKUP` for `/api/backup/export-via-token`). For non-interactive tooling (scrapers, backup). |

Every "Authenticated" / "Admin" route is mounted under `protectedRoutes`.

Main-area module routes (documents, drive, projects, ships, contacts, hr)
additionally pass the global-role module visibility gate: a non-admin user
whose role does not grant the module receives 404 (PLAN-076; see the
[architecture doc](../architecture.md#authorization-model)).

## System

| Method | Path                                       | Access        | Description                                                                                                                            |
| ------ | ------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                              | Public        | **Liveness** probe. Always returns `200 {status:"ok"}`. Use this for `livenessProbe` / Docker `HEALTHCHECK`.                              |
| GET    | `/api/health/ready`                        | Public        | **Readiness** probe. Returns `200 {status:"ready"}` when the DB is reachable; `503 {status:"db_unavailable"}` otherwise. Use this for `readinessProbe` / load-balancer pool membership. |
| GET    | `/api/system/branding`                    | Public        | Runtime display branding. Returns `{ appDisplayName }` from settings with server config fallback.                                      |
| GET    | `/api/system/version`                      | Admin         | Build provenance (commit hash, build time). Same content as `app --version` in the standalone binary.                                    |
| GET    | `/api/system/upload-limits`                | Authenticated | `{ maxFileSize, maxAttachmentsPerResource, totalQuota }`. Frontend reads this to render client-side hints.                              |
| GET    | `/api/metrics`                             | Service Token | Prometheus text exposition. Returns 503 when `SERVICE_TOKEN_METRICS` is unset.                                                                   |

## Account

### Authentication

| Method | Path                                       | Access        | Description                                                       |
| ------ | ------------------------------------------ | ------------- | ----------------------------------------------------------------- |
| GET    | `/api/account/auth/mode`                   | Public        | Reports the active login mode (`oauth` or `single-user`) so the SPA picks the right form. |
| GET    | `/api/account/auth/login`                  | Public        | Starts OAuth login.                                                |
| GET    | `/api/account/auth/callback`               | Public        | Handles OAuth callback and creates a local session.                |
| POST   | `/api/account/auth/login-local`            | Public, rate-limited | Single-user login (`username` + `password`). Active only when `SINGLE_USER_MODE=true`. |
| POST   | `/api/account/auth/logout`                 | Authenticated | Deletes the local session.                                         |
| GET    | `/api/account/auth/logout-url`             | Public        | Returns the configured upstream logout URL.                         |
| POST   | `/api/account/auth/totp/verify`            | Public, rate-limited | Completes the login-time TOTP challenge.                    |

### Current user

| Method | Path                                                | Access        | Description                                                |
| ------ | --------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| GET    | `/api/account/me`                                   | Authenticated | Current user profile with groups and the resolved `modules` list (visible main-area modules). |
| GET    | `/api/account/me/groups`                            | Authenticated | Current user's groups.                                     |
| GET    | `/api/account/me/preferences/:key`                  | Authenticated | Reads one current-user preference.                         |
| PUT    | `/api/account/me/preferences/:key`                  | Authenticated | Writes one current-user preference.                        |
| GET    | `/api/account/me/totp`                              | Authenticated | Lists current-user TOTP devices.                            |
| POST   | `/api/account/me/totp`                              | Authenticated | Creates a TOTP setup.                                      |
| POST   | `/api/account/me/totp/:deviceId/confirm`            | Authenticated, rate-limited | Confirms a newly created TOTP device.        |
| DELETE | `/api/account/me/totp/:deviceId`                    | Authenticated | Deletes a current-user TOTP device.                         |
| POST   | `/api/account/me/totp/verify`                       | Authenticated, rate-limited | Verifies a current-user TOTP code for step-up flows. |

### Users and groups

| Method | Path                                       | Access        | Description                                                                                            |
| ------ | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/account/visible-users`               | Authenticated | Active user directory exposed to every signed-in caller, for assignment and sharing pickers.            |
| GET    | `/api/account/users`                       | Admin         | Paginated user list.                                                                                    |
| GET    | `/api/account/users/:id`                   | Admin         | User detail.                                                                                            |
| PATCH  | `/api/account/users/:id`                   | Admin         | Updates role, status, global role (`globalRoleId`, nullable → default role), or profile fields.         |
| GET    | `/api/account/users/:id/groups`            | Admin         | Groups for a user.                                                                                      |
| GET    | `/api/account/groups`                      | Admin         | Group list.                                                                                             |
| POST   | `/api/account/groups`                      | Admin         | Creates a group.                                                                                        |
| GET    | `/api/account/groups/:id`                  | Admin         | Group detail.                                                                                           |
| PATCH  | `/api/account/groups/:id`                  | Admin         | Updates a group.                                                                                        |
| DELETE | `/api/account/groups/:id`                  | Admin         | Deletes a group.                                                                                        |
| GET    | `/api/account/groups/:id/members`          | Admin         | Group members.                                                                                          |
| POST   | `/api/account/groups/:id/members`          | Admin         | Adds a user to a group.                                                                                 |
| DELETE | `/api/account/groups/:id/members/:userId`  | Admin         | Removes a user from a group.                                                                            |

### Global roles

Admin CRUD for global roles (per-module visibility, PLAN-076). Mounted at
the top level following the `/global-*` admin vocabulary convention. The
system default role (kind=`default`) is editable but not deletable.

| Method | Path                                       | Access        | Description                                                       |
| ------ | ------------------------------------------ | ------------- | ----------------------------------------------------------------- |
| GET    | `/api/global-roles`                        | Admin         | Role list.                                                        |
| POST   | `/api/global-roles`                        | Admin         | Creates a role. Unknown module keys → 422; duplicate name → 409.   |
| PATCH  | `/api/global-roles/:id`                    | Admin         | Updates name and/or modules.                                       |
| DELETE | `/api/global-roles/:id`                    | Admin         | Deletes a custom role; system roles → 403.                         |

## Policy (Zanzibar tuples)

All policy routes are admin-only.

| Method | Path                                                            | Description                                                  |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/policy/tuples`                                            | Lists relation tuples.                                       |
| POST   | `/api/policy/tuples`                                            | Creates a relation tuple.                                    |
| PATCH  | `/api/policy/tuples/:id`                                        | Replaces a tuple's relation (delete + insert).                |
| DELETE | `/api/policy/tuples/:id`                                        | Deletes a relation tuple.                                    |
| POST   | `/api/policy/tuples/batch`                                      | Batch create + delete of relation tuples.                     |
| POST   | `/api/policy/check`                                             | Zanzibar permission check.                                   |
| POST   | `/api/policy/expand`                                            | Expand a relation tree.                                      |
| GET    | `/api/policy/users/:id/access`                                  | Relation tuples where the user is the subject.                |
| GET    | `/api/policy/groups/:id/access`                                 | Relation tuples where the group is the subject.               |
| GET    | `/api/policy/manifest`                                          | Permission manifest (resources, actions, namespaces) — drives the admin UI. |
| GET    | `/api/policy/entities`                                          | Lists users / groups / resource_groups for the policy UI.     |
| GET    | `/api/policy/resource-groups`                                   | Lists resource groups.                                       |
| POST   | `/api/policy/resource-groups`                                   | Creates a resource group.                                    |
| PATCH  | `/api/policy/resource-groups/:id`                               | Renames a resource group.                                    |
| DELETE | `/api/policy/resource-groups/:id`                               | Deletes a resource group.                                    |
| GET    | `/api/policy/resource-groups/:id/members`                       | Lists resource group members.                                |
| POST   | `/api/policy/resource-groups/:id/members`                       | Adds a resource group member.                                |
| DELETE | `/api/policy/resource-groups/:id/members/:tupleId`              | Removes a resource group member.                              |

## Items, files, and content sub-types

Items, the `file` module, and the two shipped sub-types (`issue` /
`document`) form one architectural layer. See [`modules/item.md`](../modules/item.md)
and [`modules/file.md`](../modules/file.md) for the design rationale; the
sub-type routes below are the public API surface.

### Documents

All document routes require authentication. `:id` is the document's
8-char short id.

| Method | Path                                          | Description                                                                                                            |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/documents`                              | Lists documents visible to the caller (admin: all; user: creator + direct shares + ancestor inheritance via `parent_item`). |
| POST   | `/api/documents`                              | Creates a document. Body accepts `parentId` for nesting.                                                                |
| GET    | `/api/documents/tree`                         | Flat `{ id, title, parentId, updatedAt, childCount }[]`, every visible document; siblings sorted by lowercased title.   |
| GET    | `/api/documents/tags`                         | All tags currently in use across documents.                                                                              |
| GET    | `/api/documents/users`                        | Active users for sharing UI.                                                                                            |
| GET    | `/api/documents/groups`                       | All groups for sharing UI.                                                                                              |
| GET    | `/api/documents/:id`                          | Document detail. Payload includes `version` (optimistic concurrency).                                                   |
| PATCH  | `/api/documents/:id`                          | Update. Body **must** include `version`; mismatch returns 409. Fields: `title`, `content`, `tags`, `parentId`, `commentsLocked`. |
| PATCH  | `/api/documents/:id/move`                     | Re-parent. Body: `{ parentId: short_id \| null }`. Validates target exists, caller can edit it, no cycle.                |
| DELETE | `/api/documents/:id`                          | **Soft delete** of the document and every descendant. Item-attachment references released — async GC reclaims blobs.    |
| GET    | `/api/documents/:id/attachments`              | List attachments (`{ id, filename, mimetype, size, ... }`).                                                              |
| POST   | `/api/documents/:id/attachments`              | Upload. Multipart `file=` field. Editor permission required.                                                             |
| GET    | `/api/documents/:id/attachments/:aid`         | Download. `?inline=true` opts into inline rendering for safe MIME types.                                                  |
| DELETE | `/api/documents/:id/attachments/:aid`         | Release the reference; async GC reclaims the blob when refcount drains.                                                  |
| GET    | `/api/documents/:id/comments`                 | List comments.                                                                                                          |
| POST   | `/api/documents/:id/comments`                 | Add comment. `replyToId` optional. Reply target must belong to the same document.                                        |
| DELETE | `/api/documents/:id/comments/:cid`            | Delete (author or admin). Replies stay readable (`reply_to_id` set NULL). **Detach attachments first** — this route does not cascade-release them.            |
| GET    | `/api/documents/:id/comments/:cid/attachments`            | List the comment's attachments.                                                                       |
| POST   | `/api/documents/:id/comments/:cid/attachments`            | Upload an attachment to the comment. Multipart `file=`. Author-only.                                  |
| GET    | `/api/documents/:id/comments/:cid/attachments/:aid`       | Download. `?inline=true` opts into inline rendering for safe MIME types.                              |
| DELETE | `/api/documents/:id/comments/:cid/attachments/:aid`       | Release the reference (uploader or admin). Async GC reclaims the blob.                                |
| GET    | `/api/documents/:id/shares`                   | List shares + inherited grants (each row carries `inheritedFrom`).                                                       |
| POST   | `/api/documents/:id/shares`                   | Add share. Writes a `(item, X, viewer\|editor, user\|group, target)` policy tuple. Re-sharing updates the role.            |
| DELETE | `/api/documents/:id/shares/:shareId`          | Delete the share — `shareId` is the policy tuple id.                                                                     |

### Issues

All issue routes require authentication. Issues are **project-scoped work
orders** — there is no global `/api/issues`; every route is nested under its
owning project and gated on project membership (non-member ⇒ fail-closed 404).
`:id` is the issue's 8-char short id and must belong to the path project. See
[`docs/modules/issue.md`](../modules/issue.md) for the model and its intentional
deltas from the access reference.

| Method | Path                                          | Description                                                                                                |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/:projectId/issues`             | List the project's work orders (members only). Filters: `q`, `status`, `priority`, `page`, `limit`.        |
| POST   | `/api/projects/:projectId/issues`             | Create. Body: `{ title, description?, status?, priority?, assigneeMemberId?, dueDate?, references? }` — `assigneeMemberId` is a `project_members.id`. |
| GET    | `/api/projects/:projectId/issues/:id`         | Detail.                                                                                                     |
| PATCH  | `/api/projects/:projectId/issues/:id`         | Update. Assignees who are neither PM nor creator can only update `status`.                                   |
| DELETE | `/api/projects/:projectId/issues/:id`         | **Soft delete** (sets `items.deleted_at`, clears policy tuples).                                              |
| POST   | `/api/projects/:projectId/issues/:id/pin`     | Pin (admin / PM / creator). BITHK-only.                                                                       |
| POST   | `/api/projects/:projectId/issues/:id/unpin`   | Unpin (same gate). BITHK-only.                                                                                |
| GET    | `/api/projects/:projectId/issues/:id/attachments`              | List attachments.                                                                       |
| POST   | `/api/projects/:projectId/issues/:id/attachments`              | Upload (multipart).                                                                     |
| GET    | `/api/projects/:projectId/issues/:id/attachments/:aid`         | Download. `?inline=true` opts into inline rendering for safe MIME types.                |
| DELETE | `/api/projects/:projectId/issues/:id/attachments/:aid`         | Release attachment reference.                                                           |
| GET    | `/api/projects/:projectId/issues/:id/comments`                 | List comments.                                                                          |
| POST   | `/api/projects/:projectId/issues/:id/comments`                 | Add comment.                                                                            |
| DELETE | `/api/projects/:projectId/issues/:id/comments/:cid`            | Delete comment (author or admin). **Detach attachments first** — no cascade-release.    |
| GET    | `/api/projects/:projectId/issues/:id/comments/:cid/attachments`      | List the comment's attachments.                                                   |
| POST   | `/api/projects/:projectId/issues/:id/comments/:cid/attachments`      | Upload an attachment to the comment. Multipart `file=`. Author-only.              |
| GET    | `/api/projects/:projectId/issues/:id/comments/:cid/attachments/:aid` | Download. `?inline=true` opts into inline rendering for safe MIME types.           |
| DELETE | `/api/projects/:projectId/issues/:id/comments/:cid/attachments/:aid` | Release the reference (uploader or admin). Async GC reclaims the blob.            |

Issue references and ship maintenance orders are top-level (not project-nested)
and BITHK-only:

| Method | Path                                          | Description                                                                                                |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/issues/:issueShortId/references`        | List an issue's generic references (any reader).                                                            |
| POST   | `/api/issues/:issueShortId/references`        | Add a reference (editor).                                                                                    |
| DELETE | `/api/issues/:issueShortId/references/:referenceId` | Remove a reference (editor).                                                                           |
| GET    | `/api/ships/:shipShortId/maintenance-orders`  | Read-only list of maintenance-template issues across a ship's bound projects (ship read gate).             |

### Files (low-level)

Uploads are always issued through a parent resource route (e.g.
`POST /api/projects/:projectId/issues/:id/attachments`) — the consumer route owns the
permission boundary. The two endpoints below are the read surface for
content that has already been uploaded; both require a `ref=<reference id>`
query parameter so the registered permission hook can resolve the consumer
context. The active permission hook for `item_attachment` references
delegates to the `policy` engine.

| Method | Path                                       | Access        | Description                                                                                                |
| ------ | ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/files/:id/metadata?ref=<refId>`      | Authenticated | `{ id, size, mimetype, filename, ownerType, ownerId, createdAt }` if the actor can read the reference's owner. |
| GET    | `/api/files/:id/content?ref=<refId>`       | Authenticated | Streams or 302-presigns. `inline=true` for inline-safe types. Presigning kicks in when the active driver supports it AND `FILE_PRESIGN_ENABLED=true`. |

## Drive

Personal and team file storage. Every route below requires authentication
(`authRequired`) **except** the two public-link routes, which answer
without a session. `:id` is an 8-char entry / share / directory nanoid.
Per-entry access is resolved from ownership, team-directory role, direct
shares and global admin (see [drive.md](../modules/drive.md#permissions)).

| Method | Path                                                   | Access            | Description                                                                                  |
| ------ | ------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/drive/entries`                                   | Authenticated     | List a folder's children. Query: `parentEntryId` (root when omitted), `status` (`normal`/`trash`). |
| GET    | `/api/drive/entries/recent`                            | Authenticated     | The caller's 50 most recently updated files.                                                 |
| GET    | `/api/drive/entries/favorites`                         | Authenticated     | The caller's favorited entries.                                                              |
| DELETE | `/api/drive/entries/trash`                             | Authenticated     | Permanently purge every trashed entry the caller owns; releases their blobs.                 |
| POST   | `/api/drive/entries/text-file`                         | Authenticated     | Create a server-side `text/plain` file. Body: `{ name, content, parentEntryId? }`.           |
| POST   | `/api/drive/folders`                                   | Authenticated     | Create a folder. Body: `{ name, parentEntryId? }`.                                           |
| POST   | `/api/drive/files/upload`                              | Authenticated     | Upload a file (multipart `file=`). Optional `parentEntryId`, `ownerType`/`ownerId` (team dir; editor+). |
| GET    | `/api/drive/entries/:id`                               | Entry read        | Entry detail.                                                                                |
| GET    | `/api/drive/entries/:id/content`                       | Entry download    | Stream the current version. `?inline=true` for inline rendering.                             |
| PATCH  | `/api/drive/entries/:id`                               | Entry update      | Rename / move / (un)favorite. Body: any of `{ name, parentEntryId, favorite }`.              |
| POST   | `/api/drive/entries/:id/restore`                       | Entry update      | Restore a trashed entry subtree.                                                             |
| DELETE | `/api/drive/entries/:id`                               | Entry delete      | Soft delete (move subtree to trash).                                                         |
| DELETE | `/api/drive/entries/:id/permanent`                     | Entry delete      | Permanently delete the subtree; releases every file reference it holds.                      |
| GET    | `/api/drive/entries/:id/versions`                      | Entry read        | List versions, newest first, each flagged `isCurrent`.                                       |
| POST   | `/api/drive/entries/:id/versions`                      | Entry update      | Upload a new version (multipart `file=`); becomes current.                                   |
| POST   | `/api/drive/entries/:id/versions/:versionId/current`   | Entry update      | Switch the current pointer to an existing version.                                           |
| GET    | `/api/drive/entries/:id/shares`                        | Entry share       | List shares created for the entry.                                                           |
| POST   | `/api/drive/entries/:id/shares`                        | Entry share       | Create a `direct` or `public_link` share.                                                    |
| GET    | `/api/drive/shares/received`                           | Authenticated     | Active direct shares where the caller is the recipient.                                      |
| GET    | `/api/drive/shares/sent`                               | Authenticated     | Direct shares the caller created.                                                            |
| GET    | `/api/drive/shares/links`                              | Authenticated     | Public-link shares the caller created.                                                       |
| PUT    | `/api/drive/shares/:id`                                | Share owner       | Update a share (permission / password / expiry / max-downloads / active).                    |
| DELETE | `/api/drive/shares/:id`                                | Share owner       | Revoke a share (sets `is_active=0`).                                                          |
| GET    | `/api/drive/team-directories`                          | Authenticated     | Directories the caller owns or is a member of.                                               |
| POST   | `/api/drive/team-directories`                          | Authenticated     | Create a team directory (creator becomes admin).                                             |
| GET    | `/api/drive/team-directories/:id`                      | Directory member  | Directory detail + the caller's effective role.                                              |
| PUT    | `/api/drive/team-directories/:id`                      | Directory admin   | Rename / re-describe.                                                                         |
| DELETE | `/api/drive/team-directories/:id`                      | Directory creator | Delete an empty directory.                                                                    |
| GET    | `/api/drive/team-directories/:id/members`              | Directory member  | List members.                                                                                |
| POST   | `/api/drive/team-directories/:id/members`              | Directory admin   | Add / upsert a member. Body: `{ userId, role? }`.                                            |
| PUT    | `/api/drive/team-directories/:id/members/:memberId`    | Directory admin   | Change a member's role.                                                                       |
| DELETE | `/api/drive/team-directories/:id/members/:memberId`    | Directory admin   | Remove a member.                                                                              |
| GET    | `/api/drive/shared/:token`                             | **Public**        | Public-link metadata only (never bytes or password hash).                                    |
| POST   | `/api/drive/shared/:token`                             | **Public**        | Verify password + quota; stream a download (`download`/`edit`) or return view metadata.      |

## HR

HR routes are gated by the `hr` module key on global roles (PLAN-076): the
default Member role does not grant it, so HR stays admin-only until an admin
grants the module to a role; users without it receive 404. See
[`modules/hr.md`](../modules/hr.md) for behavior details. An HR
colleague links to exactly one existing active `users` row (real or virtual);
list rows carry the joined user display data.

| Method | Path                                       | Description                                              |
| ------ | ------------------------------------------ | -------------------------------------------------------- |
| GET    | `/api/hr/colleagues`                  | Paginated colleague list. `?q` matches user name/username/code; `?status=active\|archived` filters. |
| POST   | `/api/hr/colleagues`                  | Creates a colleague for an active user. 404 missing user, 400 inactive, 409 already linked. |
| PATCH  | `/api/hr/colleagues/:id`              | Updates metadata, link, or status.                       |
| DELETE | `/api/hr/colleagues/:id`              | Archives (`status='archived'`); never hard-deletes.      |
| GET    | `/api/hr/approvals`                   | Paginated approval list. `?q` matches title/applicant; `?status` and `?type` filter. |
| POST   | `/api/hr/approvals`                   | Files a request for an active colleague. 404 missing, 400 archived. |
| PATCH  | `/api/hr/approvals/:id`               | Edits a pending request; decided records → 409.          |
| POST   | `/api/hr/approvals/:id/decision`      | One-way `approved\|rejected` decision with optional note; re-deciding → 409. |
| DELETE | `/api/hr/approvals/:id`               | Withdraws a pending request; decided records → 409.      |
| GET    | `/api/hr/payroll`                     | Paginated payroll list. `?colleagueId`, `?period=YYYY-MM`, `?status` filter; newest period first. |
| POST   | `/api/hr/payroll`                     | Creates a monthly record; net computed server-side. Duplicate period → 409, negative net → 400. |
| PATCH  | `/api/hr/payroll/:id`                 | Edits a pending record; `status: "paid"` marks paid (one-way). Paid records → 409. |
| DELETE | `/api/hr/payroll/:id`                 | Deletes a pending record; paid records → 409.            |

## Settings

All settings routes require admin access.

| Method | Path                                       | Description                                              |
| ------ | ------------------------------------------ | -------------------------------------------------------- |
| GET    | `/api/settings`                            | Lists settings, with sensitive values masked.            |
| GET    | `/api/settings/:key`                       | Reads one setting.                                       |
| PUT    | `/api/settings/:key`                       | Creates or updates one setting.                          |
| DELETE | `/api/settings/:key`                       | Deletes one setting.                                     |

## Audit

All audit routes require admin access.

| Method | Path                                       | Description                                              |
| ------ | ------------------------------------------ | -------------------------------------------------------- |
| GET    | `/api/audit`                               | Lists audit events.                                      |
| GET    | `/api/audit/:id`                           | Audit event detail.                                      |

## Backup

| Method | Path                                       | Access        | Description                                                                                            |
| ------ | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/backup/modules`                      | Admin         | Lists exportable backup modules (with `name` + `deps`).                                                  |
| POST   | `/api/backup/export`                       | Admin         | Exports selected modules as JSON.                                                                       |
| POST   | `/api/backup/export-via-token`             | Service Token | Same payload as `/backup/export`, gated by `SERVICE_TOKEN_BACKUP` instead of session — for backup tooling.       |
| POST   | `/api/backup/import`                       | Admin         | Imports a JSON backup file.                                                                             |

## Cron jobs

All cron routes require admin access. See [`modules/cron.md`](../modules/cron.md) for action registration, audit codes, and lifecycle.

| Method | Path                                       | Description                                                                                              |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| GET    | `/api/cron/actions`                        | Lists registered actions, supported cron formats, a human-readable help string, and `schedulerEnabled` (false when the API was started with `CRON_ENABLED=false` — admins can still write jobs; ticks are paused). |
| GET    | `/api/cron/jobs`                           | Cursor-paginated job list. `?deleted=true\|false\|only` toggles soft-deleted visibility; `?cursor` + `?limit` page. |
| POST   | `/api/cron/jobs`                           | Create. Body: `{ name, cron, action, config?, maxConsecutiveFailures? }`. `maxConsecutiveFailures` (integer 0..100, default 3) sets the per-job retry policy — see [`modules/cron.md` § Retry policy](../modules/cron.md#retry-policy). Errors: `INVALID_CRON` / `JOB_NAME_CONFLICT` / `INVALID_ACTION_CONFIG`. |
| DELETE | `/api/cron/jobs/:id`                       | Soft delete (sets `is_deleted=true`, `enabled=false`, detaches from Baker). `:id` accepts nanoid or `name`. |
| GET    | `/api/cron/jobs/:id/logs`                  | Cursor-paginated run history. `?status=running\|success\|failed` filters.                                |
| POST   | `/api/cron/jobs/:id/trigger`               | Manual run. Returns the freshly-written log row. Does not block on overlapping scheduled ticks — see [`modules/cron.md`](../modules/cron.md) for the rationale. |
| POST   | `/api/cron/jobs/:id/pause`                 | Disable: `enabled=false` + `baker.pause(...)`.                                                            |
| POST   | `/api/cron/jobs/:id/resume`                | Re-enable: `enabled=true` + `scheduler.syncJob(...)`.                                                     |

## Implemented module layout

```text
apps/api/src/modules/
  account/
    auth/
    users/
    groups/
  audit/
  backup/
  cron/
  document/        # sub-type of item
  file/            # blob storage; pluggable drivers + content dedupe
  issue/           # sub-type of item
  item/            # base for content sub-types
  policy/
  settings/
  system/
```
