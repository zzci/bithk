# Share Module

Unified token-based sharing for resources. One polymorphic `shares` table and
one set of routes serve every shareable resource type; each owning module
(currently [`document`](./document.md) and [`drive`](./drive.md)) registers an
**adapter** that validates its resource ids and renders public content. This
replaces the former per-module `document_public_links` and `drive_file_shares`
tables.

Two share flavours:

- **`direct`** — a user-to-user grant (`shared_with_user_id`).
- **`public_link`** — an anonymous token link, optionally guarded by a
  password, an expiry, and/or a download budget.

> **Collaborator grants are not shares.** `viewer` / `editor` collaboration on
> documents is expressed as `policy` tuples, not rows in this table. The share
> module only owns token-based shares.

## File layout

```text
apps/api/src/modules/share/
  schema.ts              # `shares` table + SHARE_RESOURCE_TYPES / SHARE_TYPES / SHARE_PERMISSIONS
  adapter.ts             # ShareAdapter interface + registry (registerShareAdapter)
  share.service.ts       # create / update / revoke, inboxes, the public token gate
  share.routes.ts        # /api/shares/... (authenticated management)
  share.public.routes.ts # /api/shared/:token... (no session)
  share.backup.ts        # backup contribution (`shares`)
  index.ts               # route + adapter exports, deleteSharesForResource, backup registration
  *.test.ts
```

Adapters live in the owning modules and self-register via side-effect import:
`document/document.share-adapter.ts`, `drive/drive.share-adapter.ts`.

## Database

| Table | Purpose |
|---|---|
| `shares` | Every token-based share. Columns: `id` (PK), `resource_type` (`document`\|`drive_entry`), `resource_id` (**no FK** — polymorphic), `token` (unique), `share_type` (`direct`\|`public_link`), `shared_with_user_id` (FK users, for direct), `permission` (`view`\|`download`\|`edit`), `password` (argon2id hash, write-only — never returned), `expires_at`, `max_downloads`, `download_count`, `is_active` (soft-revoke), `created_by` (FK users), `created_at`, `updated_at`. |

Indexes: unique `token`; `(resource_type, resource_id)` for cascade cleanup;
`created_by`, `shared_with_user_id`, `share_type`, `(is_active, expires_at)`.

There is deliberately no FK on `resource_id` — cascade cleanup is the owning
module's job via `deleteSharesForResource(resourceType, resourceId)`, wired
into each resource's delete path.

## Routes — management (authenticated)

Mounted under `protectedRoutes`; `authRequired`. `:type` ∈ `SHARE_RESOURCE_TYPES`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/shares/capabilities/:type` | Capabilities for a resource type (allowed `shareTypes` + `permissions`) for the UI. |
| GET | `/api/shares/received` | Direct shares received by the caller. |
| GET | `/api/shares/sent` | Direct shares the caller created. |
| GET | `/api/shares/links` | Public-link shares the caller created. |
| GET | `/api/shares/:type/:id` | All shares (direct + links) for one resource. Gated by the adapter's `authorizeManage`. |
| POST | `/api/shares/:type/:id` | Create a share for the resource (201). Body is a discriminated union — `direct`: `{ shareType, sharedWithUserId, permission }`; `public_link`: `{ shareType, permission?, password?, expiresAt?, maxDownloads? }`. Gated by `authorizeManage`. |
| PATCH | `/api/shares/:shareId` | Update `permission` / `password` (string sets, `null` clears, omit keeps) / `expiresAt` / `maxDownloads` / `isActive`. Owner-only. |
| DELETE | `/api/shares/:shareId` | Soft-revoke (`is_active=0`). Owner-only. |

## Routes — public (no session)

Mounted under `publicRoutes`. Only `public_link` shares resolve; `direct`
shares surface as 404. Content/listing/download are delegated to the adapter.

| Method | Path | Description |
|---|---|---|
| GET | `/api/shared/:token` | Link metadata only — `{ resourceType, name, isFolder, permission, requiresPassword, expired, exhausted }`. No bytes. |
| POST | `/api/shared/:token` | Pass the gate (password) and return adapter content. Body: `{ password?, childId? }`. |
| POST | `/api/shared/:token/list` | List a folder share's children (folder shares only). Body: `{ password?, parentId? }`. Returns a breadcrumb + entries. |
| POST | `/api/shared/:token/download` | Download the shared file / folder root. Body: `{ password? }`. Counts against the download budget. |
| POST | `/api/shared/:token/download/:childId` | Download a child file inside a shared folder, validated as a descendant. Body: `{ password? }`. Budget-counted. |

## The token gate

`share.service` enforces, in order, before any content is returned:

- **active** — `is_active=1` (revoke flips it).
- **password** — argon2id verify when `password` is set.
- **expiry** — `expires_at` vs now.
- **budget** — `max_downloads` vs `download_count`; the increment is a
  race-safe atomic update inside a transaction.

## The adapter contract

`registerShareAdapter(resourceType, adapter)`; an adapter provides:

| Member | Role |
|---|---|
| `capabilities` | Valid `shareTypes` + `permissions` (drives create-time validation + the capabilities endpoint). |
| `authorizeManage(c, resourceId)` | Permission hook for the management routes (resource-specific). |
| `resolve(db, resourceId)` | Resource metadata: name, `isFolder`, optional file descriptor. |
| `getContent?(db, share, childId)` | Adapter-specific payload after the gate passes. |
| `listChildren?(db, share, childId)` | Folder listing with breadcrumb (folder shares). |
| `openFile?(db, share, childId)` | File download — enforces subtree containment + permission. |

Registered adapters:

| Resource type | Capabilities | Owner |
|---|---|---|
| `document` | `public_link`, `view` only (collaborators use policy tuples) | [`document`](./document.md) |
| `drive_entry` | `direct` + `public_link`; `view` / `download` / `edit` | [`drive`](./drive.md) |

## Audit

`share.created` (POST), `share.updated` (PATCH), `share.revoked` (DELETE),
`share.accessed` (public content / download; actor is the anonymous client).

## Backup

`shareBackupContribution` (name `share`) registers the `shares` table; depends
on `users` (`created_by`, `shared_with_user_id`). Resource rows restore via
their owning modules.

## Out of scope

- Collaborator (`viewer` / `editor`) grants — those are `policy` tuples.
- Resource types beyond `document` / `drive_entry` until a module registers an adapter.
- Per-recipient notification / email of a share.
