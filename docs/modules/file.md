# File Module

Centralised blob storage for the whole app. Owns the bytes; every other
module references files by id. Built for **multi-driver storage** and
**content-addressable deduplication**.

Storage is **multi-driver** (FEAT-047): `db`, `local`, and `s3` coexist,
and each blob is served / deleted via its OWN `storage_driver`. In-app
**created** files (text / markdown / spreadsheet) and their versions are
stored in the **database** (the `db` driver); **uploaded** files go to the
DB-configured **upload driver** (`s3` or `local`). Storage configuration
lives in the DB (settings), managed from the admin **Storage module** — not
env.

The module ships schema, the local / s3 / db storage drivers, content
dedupe, refcount, async + sync GC, the presigned-download protocol, file
routes, the admin Storage routes, and the permission-hook contract. The
`item` module registers the `item_attachment` hook so item attachments
resolve permissions through the `item` policy namespace. Disk quota is
enforced via a single `SELECT SUM(size) FROM files`.

## File layout

```text
apps/api/src/modules/file/
  schema.ts                  # files + file_references + file_blob
  file.service.ts            # upload / addReference / release* / read helpers
  file.routes.ts             # GET /api/files/:id/metadata + /content
  storage.routes.ts          # admin Storage module (config / files / sync-to-s3)
  storage.service.ts         # admin file list + sync-to-s3 move
  storage-config.ts          # DB storage config read + applyStorageConfig
  file.backup.ts             # backup contribution
  gc.ts                      # async sweep over ref_count=0 candidates
  permission.ts              # consumer permission hook registry
  index.ts                   # boot wiring (initFileModule) + re-exports
  storage/
    types.ts                 # FileStorageDriver + PresignOptions
    registry.ts              # registerDriver / active + upload driver getters
    key.ts                   # sha→storage_key derivation
    local.ts                 # built-in `local` driver
    s3.ts                    # `s3` driver (client from DB config)
    db.ts                    # `db` driver (bytes in file_blob)
  file.test.ts
  storage.test.ts / storage.routes.test.ts
```

## Database

### `files`

| Column           | Type    | Notes                                                                                                              |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`             | text PK | ULID; same convention as `items.id`. Sort `id DESC` for newest-first.                                              |
| `sha256`         | text    | Lowercase hex (64 chars). Content key.                                                                              |
| `size`           | integer | Bytes.                                                                                                              |
| `mimetype`       | text    | Declared + magic-byte verified at upload.                                                                            |
| `storage_driver` | text    | `'db'` (created files), `'local'` / `'s3'` (uploads). Blobs are served/deleted via this driver — they legitimately span drivers. |
| `storage_key`    | text    | Driver-internal address. Local maps to `<root>/<ab>/<cd>/<sha>`; `db` maps to a `file_blob.storage_key`.             |
| `ref_count`      | integer | Materialised count of `file_references` rows. Async GC sweeps `ref_count = 0`.                                       |
| `uploaded_by`    | text FK | First uploader; informational. `users.id ON DELETE CASCADE`.                                                         |

Indexes: `UNIQUE(sha256, storage_driver)` — enables dedupe per backend;
`(sha256)`, `(storage_driver)`, partial `(id) WHERE ref_count = 0`.

There is **no** `created_at` column. The ULID prefix carries the upload
millisecond.

### `file_references`

The reverse table that doubles as the **attachment registry** for every
consumer. The file module's GC scans this table to maintain `ref_count`;
consumers query it directly to "list attachments on this owner". There is
**no separate `item_attachments` table** — for items, the attachment is
just a row here with `owner_type = 'item_attachment'`, `owner_id =
<item.id>`.

| Column        | Type    | Notes                                                                                                             |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`          | text PK | 8-char nanoid. External attachment id (URL surface).                                                              |
| `file_id`     | text FK | `files.id ON DELETE RESTRICT`. Releases go through `FileService`, not raw FK cascade.                              |
| `owner_type`  | text    | Discriminator. Currently `'item_attachment'` (item-level) and `'item_comment_attachment'` (per-comment); future: `'user_avatar'`, …                                              |
| `owner_id`    | text    | Consumer-side primary key. For `item_attachment`, this is `items.id`.                                              |
| `filename`    | text    | Per-reference display filename. Same blob can appear under different names on different owners.                    |
| `metadata`    | text    | Opaque JSON ('{}' default) — consumer-controlled per-reference extras.                                              |
| `created_by`  | text FK | `users.id`.                                                                                                       |
| `created_at`  | text    | ISO.                                                                                                              |

Indexes: `UNIQUE(owner_type, owner_id, file_id)` — same blob can only
appear once on any given owner; `(owner_type, owner_id)`, `(file_id)`.

### `file_blob`

Backs the `db` storage driver (FEAT-047). Created files' bytes live here
rather than on disk / S3.

| Column        | Type    | Notes                                                       |
| ------------- | ------- | ----------------------------------------------------------- |
| `storage_key` | text PK | Hour-bucketed key (`YYYYMMDDHH/<ulid>`), shared with other drivers. |
| `content`     | blob    | Raw bytes (a `Buffer`/`Uint8Array` at the driver boundary). |
| `created_at`  | text    | ISO.                                                        |

## Storage drivers

A driver implements the `FileStorageDriver` interface in
`storage/types.ts`:

```ts
interface FileStorageDriver {
  readonly name: string;
  put(key, data: ArrayBufferLike): Promise<void>;
  getStream(key): Promise<ReadableStream<Uint8Array>>;
  delete(key): Promise<void>;
  exists(key): Promise<boolean>;
  presignDownload?(key, opts: PresignOptions): Promise<string>;
  stat?(key): Promise<{ size } | null>;
}
```

Drivers register themselves via `registerDriver(...)`. Storage is
**multi-driver**: three drivers (`db`, `local`, `s3`) are always
registered and a file is served / deleted through the driver named in its
own `storage_driver` (`getDriver(file.storageDriver)`). The **upload
driver** — where new uploads land — is set from the DB config
(`storage.uploadDriver`, default `local`) via `getActiveUploadDriver()`.
There is no longer any `FILE_BACKEND_MISMATCH`: blobs legitimately span
drivers.

- **`db`** — bytes in `file_blob`. Used for in-app created files (text /
  markdown / spreadsheet) and their versions. Always server-served (no
  presign). `put` upserts, so a re-save of the same key replaces the bytes.
- **`local`** — `<root>/<ab>/<cd>/<sha>`; two-phase writes (`tmp → rename`);
  0o700 perms; no presign (streams through the API).
- **`s3`** — Bun's native `S3Client`; client built from the DB config
  (`configureS3Driver`), not env. Presigned inline previews + presigned
  direct upload.

Downstream projects can still register additional drivers in their own
code — no fork of `apps/api/src/modules/file/` required.

### Created-vs-uploaded routing

- `createDriveTextFile` / `createDriveSpreadsheet` pass `driverName: "db"`
  to `uploadAndReference`, so their bytes land in `file_blob`.
- Versions (`uploadEntryVersion` / `overwriteEntryVersion`) inherit the
  entry's current file's `storage_driver` — db files keep db versions,
  uploaded files keep versions on their driver.
- Binary uploads (`uploadDriveFile`, presigned direct upload) use the
  configured upload driver.

## Service surface

All methods take `db: AppDatabase` as the first argument.

| Method                                                                                  | What it does                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadAndReference({ file, ownerType, ownerId, uploadedBy, metadata? })`               | Magic-byte sniff, size + quota check, sha256, find-or-create `files`, write `file_references`. Returns `{ file, reference, deduped }`. Atomic in one tx.   |
| `addReference({ fileId, ownerType, ownerId, filename?, metadata?, createdBy })`         | Adds a second reference to an existing `files` row (no upload). Bumps `ref_count`.                                                                          |
| `releaseReference({ referenceId })`                                                     | Drops one reference. `ref_count = 0` triggers immediate blob delete in sync mode; async mode waits for the sweeper. Idempotent.                              |
| `releaseAllByOwner(ownerType, ownerId)`                                                 | Drops every reference for a single owner. Used when the parent resource is hard-deleted.                                                                     |
| `getFileById(id)` / `getReferenceById(id)`                                              | Lookups; no permission check (caller's responsibility).                                                                                                     |
| `listReferencesByOwner(ownerType, ownerId)`                                             | "All attachments on this owner" — `(owner_type, owner_id)`-indexed.                                                                                          |
| `buildDownloadResponse(file, ref, { inline })`                                          | Streams the body or 302s to a presigned URL (when the driver supports presign + `FILE_PRESIGN_ENABLED=true`). MIME-safety: script-bearing types forced to octet-stream. |
| `totalStoredBytes()`                                                                    | `SUM(files.size)` — drives the global upload quota.                                                                                                          |
| `runFileGcOnce(limit)`                                                                  | One sweeper pass; collects up to `limit` `ref_count = 0` blobs. Called from the periodic timer and from tests / admin tools.                                  |

`FileService` performs **no** permission checks of its own. Consumer
routes resolve "can this actor upload / read / delete?" against their
own model and call the service.

## Routes

`POST /files` is intentionally **not exposed**. Every upload comes
through the parent resource's route (e.g. `POST /api/items/:id/attachments`)
so per-resource permission stays at the consumer boundary.

The file module ships two read endpoints:

| Method | Path                                          | Description                                                                                       |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/files/:id/metadata?ref=<refId>`         | Returns `{ id, size, mimetype, filename, ownerType, ownerId, createdAt }` after permission check. |
| GET    | `/api/files/:id/content?ref=<refId>[&inline=true]` | Streams or 302-presigns. Inline-safe MIME logic mirrors the existing attachment routes.        |

Both require `?ref=<reference_id>` so the route can resolve the consumer
relationship and run that consumer's permission hook before serving.

## Permission hooks

`mod-file` does not know what an item / avatar / signature is. Each
consumer registers a hook keyed on `owner_type`:

```ts
import { registerFilePermissionHook } from "@/modules/file";

registerFilePermissionHook("item_attachment", {
  async canRead(db, actor, ref) { /* ... */ },
  async canDelete(db, actor, ref) { /* ... */ },
});
```

When no hook is registered for an `owner_type`, the file routes return
404 (so the existence of an unclaimed `owner_type` is not leaked).

The `item` module's hook (`apps/api/src/modules/item/attachment.permission.ts`)
delegates to the `policy` engine:

- `canRead`  → `check('item', ref.owner_id, 'viewer', 'user', actor.id)`
- `canDelete`→ `check('item', ref.owner_id, 'editor', 'user', actor.id)`

Admin bypass lives in the hook (not in `mod-file`).

## Garbage collection

`releaseReference` only marks the file as a candidate (`ref_count--`).
Actual blob removal happens in one of two ways:

- **`FILE_GC_MODE=async`** (default) — `gc.ts` runs every
  `FILE_GC_INTERVAL_SECONDS` (default 3600), batches up to 500 rows per
  pass, deletes the blob from the driver, then drops the `files` row.
  Drift across `ref_count` and `file_references` is reconciled at the
  same time. This is the right default for remote backends that bill
  per-delete.
- **`FILE_GC_MODE=sync`** — the foreground request also calls
  `driver.delete(...)`. Used in tests and local-only deployments. Opt-in.

The partial index `(id) WHERE ref_count = 0` keeps the candidate scan
cheap even when the `files` table grows large.

## Presigned downloads

When the active driver implements `presignDownload` AND
`FILE_PRESIGN_ENABLED=true` (default), `GET /api/files/:id/content`
returns `302 Location: <signed-url>` instead of streaming. The signed
URL is short-lived (`FILE_PRESIGN_TTL_SECONDS=300`), and the API
process never sees the bytes.

Permission is enforced at signing time via the consumer hook — re-issue
requires the hook to pass again. The short TTL is what makes this safe;
a leaked URL is dead in minutes.

`FILE_PRESIGN_ENABLED=false` forces every download through the API
(easier audit log, simpler firewalling). The built-in `local` driver
doesn't support presign and always streams.

## Configuration

Storage config is **DB-backed** (FEAT-047), managed from the admin Storage
module — env no longer selects the driver or carries S3 credentials. The
following env vars still apply (they are not storage-selection):

| Env var                       | Default                | Notes                                                                            |
| ----------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `FILE_STORAGE_LOCAL_ROOT`     | `data/uploads/files`   | Local-driver root. Relative paths resolve under `DATA_DIR` when set, otherwise under lode's data fallback or the project root. |
| `FILE_GC_MODE`                | `async`                | `async` (sweeper) or `sync` (foreground delete).                                  |
| `FILE_GC_INTERVAL_SECONDS`    | `3600`                 | Sweeper interval. `0` disables the periodic sweep (manual only).                  |
| `FILE_PRESIGN_ENABLED`        | `true`                 | Presign downloads when the driver supports it.                                    |
| `FILE_PRESIGN_TTL_SECONDS`    | `300`                  | Signed-URL lifetime.                                                              |
| `MAX_UPLOAD_MB`               | `200` (MB)             | Per-file size cap, in MB. Derived to bytes at load; the file module honours it.    |
| `MAX_ATTACHMENTS_PER_RESOURCE`| `20`                   | Per-owner reference cap.                                                          |
| `UPLOADS_TOTAL_BYTES`         | `0` (unlimited)        | Global disk quota — `SUM(files.size)`.                                            |

> `FILE_STORAGE_DRIVER` / `FILE_S3_*` remain in the config schema for
> compatibility but are **no longer consulted** for storage. The upload
> driver and S3 params come from the settings table.

### DB storage config (settings keys)

Read by `readStorageConfig(db)`; applied to the drivers at boot and after
every admin change by `applyStorageConfig(db)` (no restart). The secret ends
in `.secret`, so the settings masking hides it on read — it is write-only.

| Setting key                | Notes                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `storage.uploadDriver`     | `s3` \| `local`. Default `local` when unset.                       |
| `storage.s3.bucket`        | Required when `uploadDriver=s3`.                                    |
| `storage.s3.region`        | R2 uses `auto`; set a real region for AWS S3.                      |
| `storage.s3.endpoint`      | Account endpoint (R2: `https://<account>.r2.cloudflarestorage.com`). |
| `storage.s3.accessKeyId`   | Required when `uploadDriver=s3`.                                    |
| `storage.s3.secret`        | Sensitive — masked on read, write-only.                            |
| `storage.s3.prefix`        | Optional key prefix (a folder within the bucket).                 |

The `s3` driver targets **Cloudflare R2** by default, backed by Bun's native
`S3Client` (no AWS SDK). Every download 302s to a presigned GET (FEAT-052):
inline image/PDF previews sign `inline` + the real content-type; attachment
downloads sign `attachment; filename="…"` + `application/octet-stream`
(`response-content-disposition` / `response-content-type` are signed into the
URL, so a hostile SVG/HTML never renders inline). Only `db`-driver blobs
(spreadsheets, in-app text) still stream through the API. The R2 bucket must
allow the app origin in its **CORS** policy (`GET`/`PUT`/`HEAD`, expose `ETag`)
for fetch-based previews and direct upload. `FILE_S3_ORPHAN_TTL_HOURS` (env,
default 24h) is the grace before the orphan sweep deletes an unconfirmed
direct-upload object.

### Admin Storage module

Admin-only routes (`adminRequired`):

| Method | Path                          | Description                                                        |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/admin/storage/config`   | Current config; the S3 secret is never returned (`secretConfigured` boolean instead). |
| PUT    | `/api/admin/storage/config`   | Update; an omitted/empty secret preserves the stored one; `uploadDriver=s3` requires bucket + accessKeyId + (existing-or-new) secret. Applies at runtime. |
| GET    | `/api/admin/storage/files`    | Paginated `files` joined to their owning drive entry (`meta {total,page,limit}`). |
| POST   | `/api/admin/storage/sync-to-s3` | Moves every non-spreadsheet file not on s3 to s3 (upload → repoint → delete old blob); spreadsheets stay in `db`. Returns `{ moved, skipped, failed }`. |

### Presigned direct upload (`uploadDriver=s3`)

When the active driver supports it, the drive uploads bytes straight to S3
(`POST /drive/files/presign-upload` → browser `PUT` to the presigned URL →
`POST /drive/files/confirm-upload`). The client computes the sha256 (the
dedup key); a hash the same user already stored finishes instantly (no
upload). `presign` mints the object's hour-bucketed key and parks it in an
in-process pending registry; `confirm` reads it back and HEADs the object
for its authoritative size. Size is
enforced by the S3 backend plus an orphan sweep (`runS3OrphanSweepOnce`) that
deletes unconfirmed/unregistered objects older than `FILE_S3_ORPHAN_TTL_HOURS`.
`GET /system/upload-limits` reports `directUpload` so the web uploader
feature-detects.

### Image preview cache

Inline image requests with `?thumb=<w>` (whitelisted widths: 64/160/320/640/1280)
are served as cached WebP thumbnails generated by `Bun.Image`, same-origin with
`Cache-Control: immutable` + `ETag`. The drive file grid uses `?thumb=320` so it
no longer refetches full-resolution images and S3 is hit at most once per
(image, width). The full-resolution preview dialog still loads the original.

| Env var                       | Default                | Notes                                                                            |
| ----------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `FILE_PREVIEW_CACHE_ENABLED` | `true`                 | Set `false` to disable thumbnail caching.                                        |
| `FILE_PREVIEW_CACHE_DIR`     | `data/uploads/preview-cache` | On-disk thumbnail cache root (safe to clear).                              |

## Recipe — wire up a new file consumer

1. Pick an `owner_type` (kebab-style snake_case is conventional: `user_avatar`, `signature_image`).
2. Register a permission hook at module load:

   ```ts
   import { registerFilePermissionHook } from "@/modules/file";
   registerFilePermissionHook("user_avatar", { canRead, canDelete });
   ```

3. On upload, call `FileService.uploadAndReference({ ownerType: "user_avatar", ownerId: <user.id>, ... })`.
4. On read, list references for the owner: `FileService.listReferencesByOwner("user_avatar", userId)`.
5. On delete (single), `FileService.releaseReference({ referenceId })`.
6. On cascade (parent removed), `FileService.releaseAllByOwner("user_avatar", userId)`.
7. Download URL: `GET /api/files/:fileId/content?ref=<referenceId>` — the registered hook gates access.

## What `mod-file` deliberately does NOT do (v1)

- **Backends beyond `db` / `local` / `s3`** — the interface is stable;
  Azure / GCS land as separate driver files in downstream projects.
- **Image transforms / thumbnails / EXIF stripping**.
- **Virus / malware scanning**. A future `onBeforeStore` hook can plug ClamAV.
- **Block-level dedupe / compression**. Content-level dedupe via sha256 is plenty.
- **Streaming upload + hash** — the current 10 MiB per-file cap keeps memory bounded; streaming is a follow-up.
- **`POST /files` public route**. Uploads route through parent resources.

## See also

- [`item.md`](./item.md) — the first consumer; registers the `item_attachment` hook.
- [`policy.md`](./policy.md) — what the `item_attachment` hook delegates to.
