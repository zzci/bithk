# PLAN-102 Backup export rework: opt-in blobs, per-row driver-aware (DB-record driven)

- status: Completed
- createdAt: 2026-07-01
- relatedTask: FIX-053

## Context

The v2 archive writer (`modules/backup/archive.service.ts`, PLAN-075) selects
blob bytes with `SELECT DISTINCT sha256, storage_key, size, storage_driver FROM
files` and then streams bytes ONLY for rows whose `storage_driver` equals the
single active driver (`getActiveDriver()`); every other row is dropped with a
manifest-only warning. `local.getStream` throws on a missing file, which fails
the entire export job. Neither the export-job poll response nor the admin UI
(`-settings-backup.tsx`) surfaces `manifest.warnings`.

Reproduced (dev DB copy):

- 5 of 15 rows flipped to `storage_driver='s3'` with `local` active → export
  completes, archive contains 10 blobs, 5 files silently missing (warnings only
  inside `manifest.json`).
- One local blob file removed from disk → whole export fails with
  `Missing blob at <key>`.

FEAT-044 added the S3 driver (driver switches create exactly this mixed-row
state) and FEAT-047 / PLAN-101 (in progress, same worktree) makes db/s3/local
coexistence the norm and moves created text/md/spreadsheet content into the
`file_blob` table. After FEAT-047, active-driver-only blob export is wrong by
design.

## Goal

User-specified behaviour:

1. **Blobs are opt-in**: the export UI has one "export blobs" checkbox,
   **unchecked by default** → default export is data-only (manifest + NDJSON).
2. **Driver-mix aware, independent of the active/upload driver selection**:
   which bytes ship is decided **per `files` row from its `storage_driver` DB
   record** — multi-driver sets (local + s3 + db coexisting, FEAT-047) export
   correctly no matter which driver currently receives uploads.
3. **S3 out of scope**: never pull bytes from S3; the UI tells the operator
   that S3-stored files must be backed up directly (bucket-level tooling).
4. Robust: a local row whose disk file is missing is skipped with a warning,
   never failing the whole export; warnings are visible to the operator.

## Proposal

### Backend (`modules/backup/`)

- `archive.service.ts` blob stage — replace the active-driver gate with a
  per-row rule on `files.storage_driver`:
  - `local` → export bytes via the local driver (always available under
    FEAT-047's registry, independent of the configured upload driver).
    A read failure (missing disk file) records a warning and continues.
  - `s3` → skip bytes; ONE summary warning ("N file(s) stored in S3 are not
    part of this export — back up the bucket directly").
  - `db` (FEAT-047) → no blob entry; content travels in the `file_blob`
    NDJSON inside the data archive. Requires `file_blob` in the file module's
    backup contribution — coordinate with FEAT-047 (add it there if absent).
  - anything else (quarantine sentinel, unknown) → skip + per-row warning
    (existing behaviour).
  - `manifest.expectedBlobs` keeps inventorying every row (any driver);
    `blobs.count/totalBytes` reflect what was actually packed.
- **BLOB column codec (required for `file_blob` round-trip)**: the NDJSON
  pipeline currently has no BLOB handling — `JSON.stringify` turns a Buffer
  into `{"type":"Buffer","data":[...]}` (~4x bloat) and on import bun:sqlite
  rejects the parsed object outright ("Binding expected string, TypedArray,
  ..."), so every `file_blob` row would fail to restore. Fix: encode columns
  whose manifest type is `blob` as base64 strings on export; the import
  column-mapping stage decodes base64 → Buffer using the manifest's column
  types (with a tolerant fallback for the `{type:"Buffer",data}` shape).
- **Blob-table pagination**: `file_blob` has no `id` column, so
  `streamTableRows` falls back to LIMIT/OFFSET with 1000-row batches — large
  spreadsheet versions make that a memory hazard. Generalise keyset
  pagination to the table's single-column primary key (`storage_key`) and/or
  use a smaller batch for tables containing blob columns.
- API mapping (no route shape change): the UI checkbox maps to the existing
  `blobs` field — unchecked → `"none"`, checked → `"separate"` (data + files
  artifacts). `"embedded"` stays valid for CLI/token-route compatibility and
  uses the same per-row selection.
- Export job surface: include manifest `warnings` in the completed job's poll
  response (`export-v2.routes.ts` + token route for parity).
- CLI (`cli.ts backup:export`): unchanged flags; print warnings after success.

### Frontend (`admin/-settings-backup.tsx`)

- Replace the three-option blobs Select with a **checkbox "同时导出上传文件
  (blobs)"**, default unchecked.
- Under the checkbox, a persistent hint: locally stored uploads are exported
  as a separate compressed files archive; **files stored in S3 are not
  exported — back up the S3 bucket directly (out of scope of this feature)**.
- Completed-job panel renders manifest warnings (e.g. the S3 summary line).
- i18n: update `settings.backup.export.*` keys (en + zh).

### Explicitly out of scope

- Pulling any bytes from S3.
- Import pipeline changes (blob-restore already accepts `blobs/` entries,
  reconciles s3 rows against the bucket, and quarantines missing ones).
- FEAT-047's storage core files.

## Risks

- Concurrent FEAT-047 edits the storage surface this plan builds on (driver
  registry, `db` driver, `file_blob` table) → implement AFTER FEAT-047 merges
  and use its final APIs; verify `file_blob` is in the backup contribution.
- Archives no longer embed S3 bytes; restoring to an instance without access
  to the same bucket loses those files. Mitigated by the explicit UI hint +
  `expectedBlobs` + restore report (missing → quarantine).
- Orphaned local blobs (on disk, no `files` row) are NOT exported under
  DB-record-driven selection — by design (the DB is the source of truth).

## Verification

- BLOB codec tests: a `file_blob` row round-trips export → import
  byte-identically (base64 in NDJSON, Buffer on insert); legacy archives
  without blob columns are unaffected.
- Unit/route tests: mixed-driver set (local + s3 + db rows) exports exactly
  the local bytes with s3 summary warning and db content in NDJSON; a local
  row with a missing disk file → completed export + warning; warnings present
  in poll response; default UI request sends `blobs:"none"`, checked sends
  `"separate"`.
- Round-trip: export (checked) → import data + files artifacts → local rows
  restored, s3 rows reconciled/quarantined, db rows restored from `file_blob`.
- `bun run check` EXIT 0.
