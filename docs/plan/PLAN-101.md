# PLAN-101 DB-configured multi-driver storage + admin Storage module

- status: Done
- createdAt: 2026-07-01
- approvedAt: 2026-07-01
- completedAt: 2026-07-02
- relatedTask: FEAT-047

## Context

File storage is currently single-driver and env-configured: `initFileModule`
(`modules/file/index.ts`) reads `config.FILE_STORAGE_DRIVER` + `FILE_S3_*` /
`FILE_STORAGE_LOCAL_ROOT` from env, calls the driver's `setup(config)`, and
`setActiveDriver()`. Every file (created text/md/spreadsheet AND uploaded
binaries) goes to that single active driver via `uploadAndReference`. Serving /
delete / GC assume the active driver and 404 (`FILE_BACKEND_MISMATCH`) on any
row whose `storageDriver` differs.

The `settings` module already provides a DB key-value store with admin CRUD and
automatic masking of keys ending in a sensitive suffix (`.secret` → `******`,
and PUT rejects saving the mask) — exactly the "secret is write-only, never
displayed, only updated when a new value is provided" behaviour we want.

## Goal

- In-app **created files (text / markdown / spreadsheet) and their versions are
  stored in the database**, never in S3/local blob storage.
- **Uploaded files go to the configured driver (S3 or local)**.
- Storage is **multi-driver**: `db`, `s3`, `local` coexist; each blob is served
  / deleted via its own `storageDriver`.
- **Storage configuration lives in the DB (settings), not env**: an admin
  chooses the upload driver (s3|local) and edits S3 params in an admin **Storage
  module**, which also lists server files and can **sync all non-spreadsheet
  data to S3** (move: upload then delete the old copy; spreadsheets stay in DB).

## Proposal

### Storage core
- **`file_blob` table** (`storage_key` PK, `content` BLOB, `created_at`): backs a
  new **`db` storage driver** (`storage/db.ts`) implementing put/getStream/
  delete/exists over `file_blob`. The driver needs the app DB handle — inject it
  at boot (a module-level setter, mirroring `local`'s root). Always registered;
  no config, always available.
- **Multi-driver serving**: `buildDownloadResponse`, blob delete, and GC resolve
  the blob's driver via `getDriver(file.storageDriver)` instead of assuming the
  single active driver (removes the `FILE_BACKEND_MISMATCH` failure for mixed
  storage). `uploadAndReference` accepts an explicit target driver (default: the
  configured upload driver).
- **Routing**: `createDriveTextFile` / `createDriveSpreadsheet` and version
  writes (`uploadEntryVersion` / `overwriteEntryVersion`) for a db-backed entry
  use the **`db`** driver. Binary uploads (`uploadDriveFile`, presign) use the
  **configured upload driver**. Versions inherit the entry's current file's
  `storageDriver`.

### DB-based configuration (drop env)
- Storage config keys in `settings`: `storage.uploadDriver` (`s3`|`local`),
  `storage.s3.bucket` / `.region` / `.endpoint` / `.accessKeyId` /
  `.secret` (sensitive-masked) / `.prefix`. No `FILE_STORAGE_DRIVER` / `FILE_S3_*`
  env; when unconfigured the upload driver defaults to `local`.
- Boot reads storage config from the DB (settings) and configures the upload
  driver; the S3 client is (re)built from DB values. Config changes at runtime
  re-run setup + rebuild the client — no restart. Existing tests that force
  `setActiveDriver("local")` + `__setLocalDriverRootForTests` keep working
  (default local).

### Admin Storage module
- Backend (admin-only, `adminRequired`):
  - `GET /admin/storage/config` → current config (secret masked).
  - `PUT /admin/storage/config` → update (ignores the masked secret so an
    unchanged secret is preserved; validates s3 params when driver=s3).
  - `GET /admin/storage/files` → paginated `files` list joined to the owning
    drive entry: name, entry/path, type, size, storageDriver, uploadedBy, time.
  - `POST /admin/storage/sync-to-s3` → for every non-spreadsheet file not already
    on s3: upload its bytes to s3, repoint `storageDriver`/`storageKey`, delete
    the old blob. Spreadsheets (`application/x-univer-sheet`) are skipped.
- Frontend: an **admin Storage page** (`admin/storage.tsx` + `.lazy.tsx` +
  `-storage.nav.ts`) with a config form (driver select + S3 fields, secret
  write-only) and a paginated file list with a "Sync to S3" action.

## Verification

- `bun run check` EXIT 0 (lint, typecheck, web + api tests, build, i18n,
  api-docs, api-spec, routes).
- Backend: created text/sheet lands in `file_blob` (storageDriver=db), served
  correctly; an uploaded file lands on the configured driver; a mixed db+s3 set
  serves each via its own driver; sync moves a non-spreadsheet file db→s3 and
  deletes the old blob while a spreadsheet is skipped; config PUT preserves an
  unchanged (masked) secret; all admin routes require admin.

## Notes

- No backward compatibility — existing files keep their `storageDriver`; a dev
  reseed is expected. New behaviour applies to newly created/uploaded files.
- Secret is stored as-is (no encryption) but never returned (settings masking);
  updated only when a non-masked value is submitted.
- Sync is a move (delete source after copy), not a dual-write.
- Delivered as two coordinated parts (storage core + admin module) in one pass.
