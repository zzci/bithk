# Database

The API uses SQLite through Drizzle ORM. Table definitions live in each
module's own `apps/api/src/modules/<name>/schema.ts`;
`apps/api/src/db/schema.ts` is a re-export aggregator only and contains
no table definitions.

The single baseline migration `apps/api/drizzle/0000_*.sql` reflects the
shipped schema. `bun run --filter @app/api db:generate` regenerates it
from the source-of-truth schema files.

## Conventions

| Topic           | Current behavior                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Database        | SQLite via Bun's built-in `bun:sqlite` (Drizzle's `bun-sqlite` adapter)                                          |
| ORM             | Drizzle ORM                                                                                                     |
| Time fields     | ISO 8601 strings (`text`)                                                                                       |
| Booleans        | SQLite integer booleans (Drizzle's `integer({ mode: "boolean" })`)                                              |
| ULIDs           | `items.id`, `files.id`, `audit_events.id` — 26-char Crockford base32 with millisecond timestamp prefix          |
| Nanoids         | `items.short_id`, `file_references.id`, `relation_tuples.id`, sub-type IDs — 8 chars from `[0-9a-z]`            |
| Soft delete     | `items.deleted_at` (NULL = live). Hard delete is a future janitor (retention policy).                            |

## Tables

### Account

#### `users`
Local account records created or updated from OAuth userinfo.

Key fields: `id`, `oauth_sub`, `username`, `name`, `email`, `avatar`,
`role`, `status`, `last_login_at`, `created_at`, `updated_at`.
Unique indexes on OAuth subject, username, email.

#### `groups`
Account groups used for membership and policy subjects.

Key fields: `id`, `name`, `description`, `created_at`, `updated_at`.

#### `sessions`
Server-side OAuth sessions.

Key fields: `id`, `user_id`, `access_token`, `refresh_token`,
`expires_at`, `created_at`, `updated_at`.

#### `pkce_challenges`
Temporary OAuth PKCE state. `state`, `code_verifier`, `redirect_uri`, `expires_at`.

#### `user_preferences`
Per-user key/value preferences. Primary key: `(user_id, key)`.

#### `user_totp_devices`
TOTP devices for users. `id`, `user_id`, `name`, `secret`, `verified`,
`last_used_timestep`, `created_at`.

#### `totp_challenges`
Login-time TOTP challenges. `id`, `user_id`, `access_token`,
`refresh_token`, `expires_in`, `redirect_uri`, `expires_at`.

#### `auth_lockouts`
Persisted per-key failure counter + lockout window. `key`, `failures`,
`locked_until` (epoch ms; NULL while tracking but not locked),
`updated_at`. Keyed by purpose: `single-user:<username-lower>` for
single-user login, `totp:<user-id>` for TOTP step-up. Persisted (not
in-memory) so brute-force counters survive restart and replicas.

### Audit

#### `audit_events`
Immutable audit log records.

`id`, `actor_id`, `actor_name`, `action`, `resource_type`, `resource_id`,
`resource_name`, `detail`, `ip`, `user_agent`, `result`, `created_at`.

`detail` is nullable (use when no structured payload makes sense); every
other column is `NOT NULL`.

### Cron

#### `cron_jobs`
Scheduler job definitions. Soft-delete via `is_deleted` so `cron_job_logs`
foreign keys remain valid for retention queries; the cron route layer
filters `is_deleted=false` by default.

| Column | Notes |
| --- | --- |
| `id` | **nanoid** (8 chars). |
| `name` | Required; unique via `idx_cron_jobs_name`. |
| `cron` | Normalised cron expression. See `apps/api/src/modules/cron/cron-format.ts` for the supported grammar. |
| `task_type` | Mirrors the registered action's `category` (e.g. `maintenance`, `network`, `system`, `custom`). Free-form text. |
| `task_config` | JSON text — `{ action: "<name>", ...action-specific }`. |
| `enabled` | Integer boolean. Toggled by pause / resume; flipped to `false` automatically after `max_consecutive_failures` consecutive failures. |
| `is_deleted` | Integer boolean. Soft-delete marker. |
| `max_consecutive_failures` | Integer, default `3`. Per-job auto-pause threshold (see [`modules/cron.md` § Retry policy](../modules/cron.md#retry-policy)). `0` disables auto-pause. |
| `created_at`, `updated_at` | ISO timestamps. |

Indexes: unique `(name)`, `(enabled)`.

#### `cron_job_logs`
One row per run. `id` is a ULID so monotonic ordering matches run
order. Cascade-deletes when the parent job is hard-deleted.

| Column | Notes |
| --- | --- |
| `id` | **ULID**. |
| `job_id` | FK → `cron_jobs.id ON DELETE CASCADE`. |
| `started_at` | ISO timestamp set when the run row is created. |
| `finished_at` | ISO timestamp set when the handler resolves / throws. NULL while the job is in `status="running"`. |
| `duration_ms` | Integer, set alongside `finished_at`. |
| `status` | `'running'` / `'success'` / `'failed'`. |
| `result` | Handler's return string on success. |
| `error` | Error message on failure. |

Indexes: `(job_id)`, `(job_id, started_at)`, `(status)`.

### Settings

#### `settings`
Runtime settings stored by key. `key`, `value`, `updated_by`, `updated_at`.

### Policy (Zanzibar)

#### `relation_tuples`
Zanzibar-style relation tuples — the **single source of truth for every
access relationship** in this codebase (issue assignee, document
viewer / editor, document parent edges, group membership, …).

`id`, `namespace`, `object_id`, `relation`, `subject_namespace`,
`subject_id`, `subject_relation`, `created_by`, `created_at`.

`subject_relation` and `created_by` are nullable (system-issued tuples
have no creator; userset-style tuples leave `subject_relation` empty).

Indexes: `(namespace, object_id, relation)`, `(subject_namespace,
subject_id, subject_relation)`, plus a unique composite on the full
six-tuple key. SQLite treats `NULL` as distinct in `UNIQUE` indexes,
so service code performs a defensive duplicate check before insert.

### Items (the content base)

#### `items`
Universal metadata for every content-style object (issue, document,
future ticket / purchase order / expense / …).

| Column        | Notes                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | **ULID** (26 chars). Timestamp prefix encodes the creation millisecond — sort `id DESC` for newest-first; no separate `created_at` column. |
| `short_id`    | **nanoid** (8 chars). Unique. The id surfaced in URLs / API payloads / audit `resource_id`.                                            |
| `type`        | Opaque sub-type discriminator (`'issue'`, `'document'`, …).                                                                                |
| `title`       | Required.                                                                                                                                |
| `status`      | Opaque text marker; sub-type defines allowed values.                                                                                       |
| `creator_id`  | FK → `users.id ON DELETE CASCADE`.                                                                                                       |
| `version`     | Integer, default 1. Optimistic-concurrency counter — bumped on every update.                                                              |
| `deleted_at`  | Soft-delete timestamp; NULL = live. Read paths must filter on this.                                                                       |
| `updated_at`  | ISO timestamp.                                                                                                                          |

Indexes: `(short_id)` unique, `(type, deleted_at)`, `(creator_id, deleted_at)`, `(type, status, deleted_at)`.

#### `item_comments`
Comments attached to any item, regardless of sub-type. Flat reply
model — a comment either replies to one other comment in the same item,
or is top-level.

| Column        | Notes                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | nanoid PK.                                                                                                                            |
| `item_id`     | FK → `items.id ON DELETE CASCADE`.                                                                                                    |
| `author_id`   | FK → `users.id ON DELETE CASCADE`.                                                                                                    |
| `reply_to_id` | FK → `item_comments.id ON DELETE SET NULL`. Single upward edge — no thread tree.                                                       |
| `content`     | Required text.                                                                                                                         |
| `is_internal` | Boolean; `1` = hidden from viewer-only actors. Replies inherit from their target so threads don't leak across the visibility boundary. |
| `created_at`, `updated_at` | ISO.                                                                                                                       |

### Files

#### `files`
Storage row per stored blob. Content-addressable: `UNIQUE(sha256,
storage_driver)` enables dedupe per backend.

| Column           | Notes                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`             | ULID PK.                                                                                                                    |
| `sha256`         | 64-char lowercase hex content key.                                                                                          |
| `size`           | Bytes.                                                                                                                      |
| `mimetype`       | Declared + magic-byte verified at upload.                                                                                    |
| `storage_driver` | `'local'`, `'s3'`, `'azure-blob'`, … (whatever drivers register).                                                            |
| `storage_key`    | Driver-internal address (local driver uses `<ab>/<cd>/<sha>`).                                                                |
| `ref_count`      | Materialised count of `file_references` rows. The async GC sweeper picks rows where `ref_count = 0` for collection.          |
| `uploaded_by`    | FK → `users.id ON DELETE CASCADE`. First uploader; informational only.                                                       |

Indexes: `UNIQUE(sha256, storage_driver)`, `(sha256)`, `(storage_driver)`, partial `(id) WHERE ref_count = 0` for the GC.

#### `file_references`
Reverse table. **Doubles as the attachment registry** for every
consumer — no separate `*_attachments` tables.

| Column        | Notes                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`          | nanoid PK. The id surfaced as the external attachment id in URLs.                                                     |
| `file_id`     | FK → `files.id ON DELETE RESTRICT`. Releases go through `FileService`, not raw cascade.                                |
| `owner_type`  | Discriminator: `'item_attachment'` (item-level), `'item_comment_attachment'` (per-comment), … one per consumer module. |
| `owner_id`    | Consumer-side primary key. For `item_attachment` → `items.id`; for `item_comment_attachment` → `item_comments.id`.    |
| `filename`    | Per-reference display filename.                                                                                       |
| `metadata`    | Opaque JSON ('{}' default).                                                                                           |
| `created_by`  | FK → `users.id`.                                                                                                      |
| `created_at`  | ISO.                                                                                                                  |

Indexes: `UNIQUE(owner_type, owner_id, file_id)` — same blob can only
appear once per owner; `(owner_type, owner_id)`, `(file_id)`.

### Content sub-types

#### `issue_details`
Issue-specific fields keyed off `item_id` (1:1 with `items` rows where
`type='issue'`).

| Column        | Notes                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `item_id`     | PK + FK → `items.id ON DELETE CASCADE`.                                                                              |
| `description` | Long-text description; sub-type-specific (not in `items`).                                                            |
| `priority`    | Enum text: `'low' \| 'medium' \| 'high' \| 'urgent'`. Default `'medium'`.                                              |
| `due_date`    | Nullable ISO date string.                                                                                             |

There is **no `assignee_id` column**. The assignee relationship lives as
a `relation_tuples` row `(item, X, assignee, user, Y)` — single source of
truth across the codebase.

#### `document_details`
Document-specific fields keyed off `item_id`.

| Column            | Notes                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `item_id`         | PK + FK → `items.id ON DELETE CASCADE`.                                                                              |
| `content`         | Long text (≤ 50 000 chars enforced at zod boundary).                                                                  |
| `parent_id`       | Nullable self-FK to `items.id` via `documents → items` (`ON DELETE CASCADE`). **Business hierarchy column** — drives the sidebar tree. |
| `comments_locked` | Boolean. When 1, new comments are rejected.                                                                            |

Tags are **not** a column on `document_details` — they live in the
`document_tags` join (see [Tags](#tags)).

The **permission edge** for the parent hierarchy is a separate
`relation_tuples` row `(item, X, parent_item, item, Y)` written /
rewritten in lockstep with `parent_id`. The two are read for two
different purposes; neither derives the other. Document sharing is also
expressed as policy tuples (`viewer` / `editor`), not as a dedicated
shares table.

### Tags

Shared, type-scoped tag vocabulary owned by the `tag` module (see
[`modules/tag.md`](../modules/tag.md)). One vocabulary table plus three
assignment joins — project, contact, and document share the table without
referencing each other.

#### `tags`
Central tag vocabulary.

| Column        | Notes                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`          | nanoid PK.                                                                                                     |
| `name`        | Display name. **Uniqueness is type-scoped**, not global.                                                        |
| `source_type` | Discriminator: `'project' \| 'contact' \| 'document'`. Scopes the namespace so each domain is independent.      |
| `created_at` / `updated_at` | ISO strings.                                                                                     |

Unique index on `(source_type, name)` — the same name may exist once per source
type, never globally.

#### `project_tags` / `contact_tags` / `document_tags`
Assignment joins, owned by their respective domain modules. Each links a domain
row to a `tags` row and cascades on tag delete.

| Table           | Owner module | PK | Tag FK |
| --------------- | ------------ | -- | ------ |
| `project_tags`  | `project`    | `(project_id, tag_id)` | `tag_id` → `tags.id ON DELETE CASCADE` |
| `contact_tags`  | `contact`    | `(contact_id, tag_id)` | `tag_id` → `tags.id ON DELETE CASCADE` |
| `document_tags` | `document`   | `(item_id, tag_id)`    | `tag_id` → `tags.id ON DELETE CASCADE` |

### Drive

Personal and team file storage. The drive owns its own five tables (it is
**not** a sub-type of `item`); file bytes are held by the `file` module
(`files` / `file_references`).

#### `drive_entries`
A folder or file node in a drive tree.

| Column              | Notes                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                | PK — 8-char nanoid.                                                                                            |
| `owner_type`        | Enum text: `'user' \| 'team_directory'`.                                                                       |
| `owner_id`          | `users.id` (personal) or `team_directories.id` (team).                                                         |
| `parent_entry_id`   | Parent folder id, or `''` for a root entry (empty string, not null).                                           |
| `entry_type`        | Enum text: `'folder' \| 'file'`.                                                                               |
| `name`              | Entry name (no path separators; ≤ 255 chars).                                                                 |
| `file_reference_id` | Nullable FK → `file_references.id ON DELETE RESTRICT` — the current version pointer (files only).            |
| `favorite`          | Enum text `'0' \| '1'`. Default `'0'`.                                                                          |
| `status`            | Enum text: `'normal' \| 'trash'`. Default `'normal'` (soft delete).                                            |
| `created_by`        | FK → `users.id ON DELETE CASCADE`.                                                                            |
| `created_at` / `updated_at` | ISO strings.                                                                                            |

Unique on `(owner_type, owner_id, parent_entry_id, name, status)` — no two
live entries share a name in the same folder.

#### `team_directories`
A shared drive root with role-based membership.

| Column         | Notes                                                       |
| -------------- | ----------------------------------------------------------- |
| `id`           | PK — 8-char nanoid.                                         |
| `name`         | Directory name.                                             |
| `description`  | Nullable text.                                              |
| `created_by`   | FK → `users.id ON DELETE CASCADE`. The creator is an implicit admin. |
| `created_at` / `updated_at` | ISO strings.                                   |

#### `team_directory_members`
Explicit membership rows (the creator is admin without a row).

| Column         | Notes                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `id`           | PK — 8-char nanoid.                                                   |
| `directory_id` | FK → `team_directories.id ON DELETE CASCADE`.                        |
| `user_id`      | FK → `users.id ON DELETE CASCADE`. Unique with `directory_id`.       |
| `role`         | Enum text: `'admin' \| 'editor' \| 'viewer'`. Default `'viewer'`.    |
| `created_at`   | ISO string.                                                           |

#### `drive_file_versions`
Append-only version history for a file entry.

| Column              | Notes                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| `id`                | PK — 8-char nanoid.                                                    |
| `drive_entry_id`    | FK → `drive_entries.id ON DELETE CASCADE`.                            |
| `file_reference_id` | FK → `file_references.id ON DELETE RESTRICT` — this version's bytes.  |
| `version_no`        | Monotonic per entry; unique with `drive_entry_id`.                     |
| `uploaded_by`       | FK → `users.id ON DELETE CASCADE`.                                   |
| `created_at`        | ISO string.                                                            |

A version is "current" when `drive_entries.file_reference_id` equals its
`file_reference_id`. Permanent delete releases every version reference.

#### `drive_file_shares`
Direct (user-to-user) and public-link shares for a file entry.

| Column                | Notes                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| `id`                  | PK — 8-char nanoid.                                                                   |
| `drive_entry_id`      | FK → `drive_entries.id ON DELETE CASCADE`.                                           |
| `token`               | Unique 256-bit url-safe random hex token.                                             |
| `share_type`          | Enum text: `'direct' \| 'public_link'`. Default `'public_link'`.                      |
| `shared_with_user_id` | FK → `users.id ON DELETE CASCADE` — the recipient (direct shares only).             |
| `permission`          | Enum text: `'view' \| 'download' \| 'edit'`. Default `'view'`.                        |
| `password`            | Nullable `Bun.password` hash (public links only).                                     |
| `expires_at`          | Nullable ISO string.                                                                  |
| `max_downloads`       | Nullable cap; `download_count` is the running total (default 0).                      |
| `is_active`           | Integer boolean; revoke flips it to 0. Default 1.                                     |
| `created_by`          | FK → `users.id ON DELETE CASCADE`.                                                   |
| `created_at` / `updated_at` | ISO strings.                                                                    |

## Schema scope

The current schema covers: accounts (users / groups / sessions / TOTP /
preferences / PKCE state / auth lockouts), audit, settings, Zanzibar
tuples, items + item comments, files + file references, the two
sub-type detail tables (`issue_details`, `document_details`), the shared
tag vocabulary (`tags`) with its three assignment joins (`project_tags`,
`contact_tags`, `document_tags`), and the drive's own five tables
(`drive_entries`, `team_directories`, `team_directory_members`,
`drive_file_versions`, `drive_file_shares`).

Group membership is **not** a dedicated table — it lives as
`relation_tuples` rows in the `group` namespace, queried via
`policy.listGroupMembersWithJoinedAt`.

A downstream project that needs additional content modules (tickets,
purchase orders, …) builds them on top of `item` — see
[`modules/item.md`](../modules/item.md) "Adding a sub-type" recipe.
