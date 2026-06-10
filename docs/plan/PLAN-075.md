# PLAN-075 - Backup module v2: cross-schema tar.gz export/import

- Status: Draft
- Task: [FEAT-023](../task/FEAT-023.md)
- Campaign: bqnuoyra/wktf3nhs
- Created: 2026-06-10

## Overview

Backup v1 streams a single JSON document of table rows and restores it with
delete-then-insert semantics. Two declared limitations now block real
operational use:

1. **File blobs are out of scope.** A v1 backup restored onto a fresh
   deployment leaves every `files` row pointing at a missing object; the
   post-restore reconciliation can only quarantine them
   (`restore.service.ts` → `reconcileRestoredFiles`).
2. **Only matching schema versions are accepted.** `docs/modules/backup.md`
   states "Cross-version migration of backup files" is out of scope. After a
   refactor changes the schema, an old backup is unusable — exactly when a
   backup is most needed.

Backup v2 replaces the wire format with a staged, downloadable `.tar.gz`
archive that carries table rows, schema metadata, and the referenced blob
bytes, and replaces the import path with a **tolerant, cross-schema, merge**
importer: old-schema archives import into the new live schema with
column-level mapping, per-module transform hooks, duplicate-ID skip, and a
full dry-run report before anything is written.

The v1 module structure stays: `BackupContribution` self-registration and
dependency resolution in `apps/api/src/modules/backup/registry.ts` remain the
single source of module/table ordering. v2 is additive routes and services in
the same module.

## Goals

- Single `.tar.gz` archive: `manifest.json` + per-table NDJSON + deduplicated
  content-addressed blobs (R1).
- Server-side staged generation with an async job lifecycle: trigger, poll,
  download, cleanup, TTL sweep of orphans (R1).
- Cross-schema import: a backup exported from an OLD schema imports into the
  NEW live schema with complete, reported mapping of old data (R2).
- Merge import: insert in dependency order, skip rows whose primary key
  already exists, never delete live rows (R3).
- Blob import into the active storage driver with content-addressed skip,
  followed by the existing `reconcileRestoredFiles` consistency check (R4).
- Admin Settings "Backup" tab: export with module multi-select and progress,
  import with dry-run preview and explicit confirm, en + zh (R5).
- Admin-only routes, service-token export parity, upload caps, zip-slip and
  decompression-bomb defence, secret redaction parity, audit events (R6).

## Non-goals (out of scope)

- Scheduled backups.
- Off-site / incremental / differential backups.
- Cross-database-engine portability (the archive is SQLite-shaped; importing
  into a non-SQLite deployment is not supported).
- Downgrade imports: an archive whose `formatVersion` or app schema position
  is **newer** than the running binary is rejected, same policy as v1.
- Real-time replication or point-in-time recovery.

## Archive format spec (R1)

### Layout

```text
<app>-backup-v2-<timestamp>.tar.gz
├── manifest.json                  # first tar entry, always
├── data/
│   ├── users.ndjson               # one JSON object per line, drizzle property names
│   ├── projects.ndjson
│   └── ...                        # one file per exported table, dependency order
└── blobs/
    └── <ab>/<cd>/<sha256>         # raw bytes, key = deriveStorageKey(sha256)
```

Decisions and rationale:

- **Per-table NDJSON, not a single `data.json`.** NDJSON streams row-by-row
  in both directions with bounded memory (the v1 exporter's keyset
  pagination carries over per table); a corrupted line damages one row, not
  the whole document; per-table entries let the importer skip vanished
  tables without parsing their payload; and table-level tar entries give
  natural per-table progress reporting. A single `data.json` would force a
  whole-document parse on import and loses all of that for no benefit.
- **Blob paths reuse the existing storage key shape** `<ab>/<cd>/<sha256>`
  from `apps/api/src/modules/file/storage/key.ts` (`deriveStorageKey`),
  prefixed `blobs/`. Content addressing makes deduplication automatic: each
  distinct `sha256` appears exactly once regardless of how many `files` rows
  or `file_references` point at it.
- **`manifest.json` is always the first tar entry** so the importer can
  validate format, version, and caps before reading any data.
- **Tar entry sizes:** the tar header needs each entry's size up front.
  Table NDJSON is therefore written to a staging temp file first, then
  packed (the archive is staged server-side anyway). Blob sizes are known
  from `files.size`, so blobs stream from the storage driver straight into
  the tar without temp copies.
- **Compression:** gzip via the Web Streams `CompressionStream("gzip")` /
  `DecompressionStream("gzip")` built into Bun — no native dependency. Tar
  packing/parsing uses the `tar-stream` npm package (streaming pack/extract,
  battle-tested, no filesystem coupling, so entry paths never touch the real
  FS implicitly). Final library choice is re-validated at implementation
  time (see Open questions).
- Export request accepts `blobs: "embedded" | "separate" | "none"`
  (default `"embedded"`; see R7 below). `"none"` degrades the archive to
  v1 row-only semantics (plus manifest), for operators who back blobs up
  out-of-band. The original boolean `includeBlobs` is kept as a
  **deprecated alias**: `true → embedded`, `false → none`; an explicit
  `blobs` value wins when both are sent.

### R7 — Separate blob export

R7 scope change (2026-06-10, binding): an export job can split blob bytes
into their own artifact so the (usually small) row data downloads and
imports independently of the (potentially huge) blob payload.

- `blobs: "separate"` makes the job produce **two artifacts in the same
  staging job dir**:
  - `archive.tar.gz` — manifest + NDJSON only, **zero** `blobs/` entries;
  - `blobs.tar.gz` — **only** `blobs/<ab>/<cd>/<sha256>` entries (same
    layout and validation rules as embedded blobs), **no manifest inside**.
- Each artifact commits via the same `.partial` → rename step, so a
  partial file is never downloadable.
- Manifest additions (present in **all** modes):
  - `blobsMode: "embedded" | "separate" | "none"` — how this export
    placed blob bytes (`includeBlobs` stays as the deprecated boolean
    alias, `= blobsMode !== "none"`);
  - `expectedBlobs`: the full list of
    `{ sha256, size, storageKey, storageDriver }` for **every** blob
    referenced by exported `files` rows — including blobs whose bytes were
    not exported (mode `none`, inactive driver) — so import can report
    exactly which blobs are expected and which are missing.
  - The `blobs` count/totalBytes summary keeps describing the bytes this
    export actually wrote: the embedded set, the `blobs.tar.gz` content,
    or `{0, 0}` for `none`.
- Download route gains an `?artifact=data|blobs` selector (default
  `data`); `artifact=blobs` on a non-separate job is a 400. The job
  transitions to `downloaded` (and staging is cleaned) only after **every**
  artifact has been downloaded; per-artifact downloaded flags are tracked
  and surfaced by the poll route. `DELETE` still discards everything at
  once; the TTL sweep is unchanged.
- Phase mapping: the **export side** of R7 is this amendment (folded into
  Phase 1); the **import side** (consuming `expectedBlobs` and a separate
  `blobs.tar.gz` upload) lands with Phase 3; the **UI** (mode selector,
  two download buttons) with Phase 5.

### `manifest.json` example

```json
{
  "format": "bithk-backup",
  "formatVersion": 2,
  "exportedAt": "2026-06-10T08:30:00.000Z",
  "app": {
    "name": "bithk",
    "version": "0.1.0",
    "commit": "e61d052"
  },
  "schema": {
    "dialect": "sqlite",
    "journal": {
      "lastIdx": 0,
      "lastTag": "0000_oval_warbird",
      "entryCount": 1
    }
  },
  "redacted": false,
  "includeBlobs": true,
  "blobsMode": "embedded",
  "modules": [
    { "name": "users", "deps": [] },
    { "name": "files", "deps": ["users"] }
  ],
  "tables": [
    {
      "name": "files",
      "module": "files",
      "file": "data/files.ndjson",
      "rowCount": 1342,
      "primaryKey": ["id"],
      "columns": [
        { "name": "id", "type": "text", "notNull": true },
        { "name": "sha256", "type": "text", "notNull": true },
        { "name": "size", "type": "integer", "notNull": true },
        { "name": "mimetype", "type": "text", "notNull": true },
        { "name": "storageDriver", "type": "text", "notNull": true },
        { "name": "storageKey", "type": "text", "notNull": true },
        { "name": "refCount", "type": "integer", "notNull": true, "hasDefault": true },
        { "name": "uploadedBy", "type": "text", "notNull": true, "references": "users.id" }
      ]
    }
  ],
  "blobs": {
    "count": 1180,
    "totalBytes": 73400320
  },
  "expectedBlobs": [
    {
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "size": 62208,
      "storageKey": "9f/86/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "storageDriver": "local"
    }
  ]
}
```

Field notes:

- `schema.journal` is read from `apps/api/drizzle/meta/_journal.json`
  (last entry `idx`/`tag` plus entry count). It pins exactly which migration
  state produced the archive; transform hooks key off it (see R2).
- `tables[].columns` is produced by drizzle runtime introspection
  (`getTableColumns` exposes name, SQL type, `notNull`, `hasDefault`;
  FK references come from the column's `references` config). No
  hand-maintained schema copy.
- Column names use drizzle property names (camelCase) — identical to what
  the v1 exporter emits and what `tx.insert(table).values(...)` consumes,
  so no name mapping layer is needed on either side.
- `redacted: true` marks token-route exports whose secret fields were
  stripped (see Security).
- `blobsMode` / `expectedBlobs` are R7 additions (see the R7 section);
  `includeBlobs` is the deprecated alias of `blobsMode !== "none"`.

## API design

All routes mount in the existing backup module under `protectedRoutes`.
v1 routes are untouched (their fate: see Duplicate/conflict semantics).

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/backup/modules` | Admin | Existing. Lists data modules + deps; reused by the new UI. |
| POST | `/api/backup/v2/exports` | Admin | Start a server-side export job. Body: `{ modules: string[], blobs?: "embedded" \| "separate" \| "none", includeBlobs?: boolean }` (`blobs` defaults to `embedded`; `includeBlobs` is a deprecated alias — `true→embedded`, `false→none`, explicit `blobs` wins). Returns `{ jobId }` (202). |
| GET | `/api/backup/v2/exports/:jobId` | Admin | Poll job status: state, blobs mode, progress (tables done / total, blob bytes done / total), error, archive size, per-artifact size + downloaded flags when complete. |
| GET | `/api/backup/v2/exports/:jobId/download?artifact=data\|blobs` | Admin | Stream a finished artifact (`artifact` defaults to `data`; `blobs` only exists for separate-mode jobs — 400 otherwise; 404 until `completed`). The job flips to `downloaded` and staging is deleted only after **every** artifact's response drains. |
| DELETE | `/api/backup/v2/exports/:jobId` | Admin | Cancel a running job or discard a finished archive; removes staging files. |
| POST | `/api/backup/v2/exports-via-token` | Service token (`backup` scope) | Token parity for the job trigger: same body, **fail-closed module scope required**, archive generated **redacted**. Returns `{ jobId }`. |
| GET | `/api/backup/v2/exports/:jobId/status-via-token` | Service token | Token-side poll for a job created via token. |
| GET | `/api/backup/v2/exports/:jobId/download-via-token` | Service token | Token-side download of a token-created (redacted) job only. |
| POST | `/api/backup/v2/imports` | Admin | Multipart upload of a `.tar.gz`. Validates the archive, stages it, runs the mapping **dry-run**, returns `{ importId, report }`. Nothing is written to live data. |
| GET | `/api/backup/v2/imports/:importId` | Admin | Poll import status: `validated` (dry-run report available), `applying`, `completed` (final report), `failed`. |
| POST | `/api/backup/v2/imports/:importId/apply` | Admin | Apply the staged import. Body: `{ mode: "merge" \| "replace", includeUsers?: boolean }`. Returns 202; result via polling. |
| POST | `/api/backup/v2/blob-restores` | Admin | Standalone blob restore (R7): multipart upload of a separate-mode `blobs.tar.gz` (no manifest inside, by design). Blobs-only entry allowlist + the import caps; per-entry `exists` skip + streamed sha verification; finishes with un-quarantine + `reconcileRestoredFiles`. Synchronous result report `{ written, skippedExisting, failed, unquarantined, reconcile }`; idempotent by construction. |
| DELETE | `/api/backup/v2/imports/:importId` | Admin | Discard a staged import without applying. |

Token routes can only see jobs created by the same token bucket; admin
routes can see all jobs. The v1 per-token in-flight semaphore and
`BACKUP_EXPORT_MIN_INTERVAL_SECONDS` gate apply to the token trigger
unchanged. Admin export triggers get a process-wide "one running export
job at a time" guard (same WAL-pressure rationale).

## Export pipeline & staging lifecycle (R1)

Staging root: `${DATA_DIR}/backup-staging/` with `exports/<jobId>/` and
`imports/<importId>/` subtrees. `DATA_DIR` already resolves through
`apps/api/src/config.ts` (lode-aware), so staging lands on the persistent
volume, not tmpfs.

### Job state machine

```text
            POST /v2/exports
                  │
                  ▼
   pending ──► running ──► completed ──► downloaded ──► (cleaned, job gone)
                  │             │
                  │ error       │ DELETE / TTL expiry
                  ▼             ▼
               failed ──────► (cleaned)
```

Steps while `running`:

1. Resolve modules via `resolveModulesWithDeps`; snapshot the table list.
2. For each table (dependency order): stream rows with the v1 keyset
   pagination into `exports/<jobId>/tmp/<table>.ndjson`; record row count.
3. If `includeBlobs`: `SELECT DISTINCT sha256, storage_key, size FROM files`
   restricted to exported rows whose `storage_driver` equals the active
   driver; record the blob list. Quarantined rows (sentinel driver) and
   rows on inactive drivers are listed in the manifest's `warnings` but
   their bytes are not exported (we cannot read them).
4. Write `manifest.json`; pack manifest + table files + blobs (streamed
   from the driver) through `tar-stream` → `CompressionStream("gzip")` →
   `exports/<jobId>/archive.tar.gz.partial`; rename to `archive.tar.gz` on
   success (rename-as-commit: a `.partial` file is never downloadable).
5. Delete `tmp/`; mark `completed`.

Why async-job rather than a synchronous streaming response: with blobs the
archive can be many GB; gzip is CPU-bound; a synchronous response ties the
result to one fragile HTTP connection (browser timeouts, proxies), cannot
be retried without recomputing, and gives no progress signal. Staging makes
download a cheap re-streamable file read and gives the UI real progress.

Job bookkeeping is **in-memory** (process-local map), mirroring the v1
in-flight semaphore approach; the filesystem is the durable part. After a
crash/restart, in-memory jobs are gone (poll returns 404 → UI tells the
operator to re-export) and leftover staging directories are reclaimed by
the sweep. This avoids a jobs table for a strictly-operational artifact.

### Cleanup & TTL sweep

- Successful download: staging directory removed after the response body
  fully drains (download wrapper mirrors the v1 stream-release pattern).
  R7: with two artifacts, removal waits until every artifact has drained.
- Explicit `DELETE`: immediate removal (in-flight jobs are cancelled via an
  abort flag checked between batches).
- **TTL sweep:** on boot and every hour, delete any
  `backup-staging/**` entry older than `BACKUP_STAGING_TTL_HOURS`
  (default 24). This reclaims archives never downloaded, uploads never
  applied, and `tmp/` debris from crashed jobs. Sweep is mtime-based and
  needs no job state.

New config keys: `BACKUP_STAGING_TTL_HOURS` (default 24),
`BACKUP_IMPORT_MAX_ARCHIVE_BYTES` (default 2 GiB),
`BACKUP_IMPORT_MAX_BLOB_BYTES` (per-entry, default 256 MiB, ≥ the file
module's upload cap so any legitimately uploaded blob re-imports).

## Import pipeline stages (R2, R3, R4)

```text
upload ─► 1 validate ─► 2 dry-run ─► (operator confirms) ─► 3 map ─► 4 merge ─► 5 blobs ─► 6 reconcile ─► 7 report
              │              │                                                  (tx commit)
              ▼              ▼
           reject        report only, zero writes
```

1. **Validate** (streaming, during upload):
   - Size cap on the compressed upload; decompressed caps enforced while
     streaming (see Security).
   - First entry must be `manifest.json`; `format`/`formatVersion` checked;
     `formatVersion` newer than the binary supports → reject
     (`UNSUPPORTED_VERSION`, same policy as v1).
   - Every entry path must be exactly `manifest.json`, `data/<name>.ndjson`,
     or `blobs/<ab>/<cd>/<64-hex>` with the prefix bytes matching the hash —
     anything else (absolute paths, `..`, symlink/hardlink/device entries)
     → reject the whole archive.
   - Per-row sanity reuses v1: `assertSane` shape limits, `assertIdShape`,
     row-count caps (`MAX_ROWS_PER_TABLE`, `MAX_TOTAL_ROWS`).
   - The validated archive is staged at `imports/<importId>/archive.tar.gz`;
     table NDJSON is parsed into memory (bounded by the row caps — blob
     bytes, the unbounded part, stay in the archive untouched).
2. **Dry-run** (automatic on upload): run stages 3–4 inside a transaction
   that **always rolls back**, with blob writes replaced by
   existence-checks. Because it executes the real mapping and real inserts
   against the real live schema, the report is exact — duplicate counts,
   FK orphans, and constraint failures are observed, not predicted. SQLite
   rollback makes this cheap. The dry-run report is returned from the
   upload call and kept on the staged import.
3. **Map** (per table, before insert):
   - Build the live-schema view from the registry's drizzle tables
     (`getTableColumns`), compare against `manifest.tables[]`, and apply
     the Schema-mapping rules table below.
   - Apply registered **import transforms** (below) — renames, splits,
     moves between tables.
   - Application-level FK pre-check: for each FK column (known from drizzle
     introspection), the referenced id must exist in the live table or in
     the to-be-inserted set; otherwise the row fails as `missing-parent`
     before SQL ever sees it. This preserves per-row granularity that
     `PRAGMA defer_foreign_keys` (whole-transaction, COMMIT-time) cannot
     give.
4. **Merge** (one synchronous transaction, like v1 — bun:sqlite transactions
   must stay sync):
   - Tables in dependency order (existing `resolveModulesWithDeps` walk).
   - Per row: probe by primary key → exists: count `skippedDuplicate`;
     else insert; a unique-index violation on insert (non-PK) → count
     `failed` with the constraint name — except the `files` special case
     below.
   - `defer_foreign_keys` stays on for the known module cycles
     (projects ↔ ships); the FK pre-check makes COMMIT-time failures
     near-impossible, but if one occurs the transaction aborts and the
     import is reported `failed` wholesale (no partial commit).
5. **Blobs**: stream the staged archive a second time; for each
   `blobs/<ab>/<cd>/<sha>` entry referenced by a `files` row that is now
   live: `driver.exists(key)` → skip (content-addressed dedupe); else
   recompute sha256 while streaming and `driver.put` only if the hash
   matches the path (mismatch → count `failed` blob, row left for
   reconcile). Blobs not referenced by any live `files` row are skipped.
6. **Reconcile**: run the existing `reconcileRestoredFiles` unchanged as
   the final consistency check — any `files` row whose bytes still are not
   on the active driver gets quarantined exactly as today.
7. **Report**: persist the final report on the import job; UI renders it.

### Cross-schema mapping & transform hooks (R2)

`BackupContribution` is extended (registry stays the single registration
point; no central list):

```ts
export interface BackupContribution {
  readonly name: string;
  readonly tables: readonly SQLiteTable[];
  readonly deps: readonly string[];
  /** v2: fill values for NEW NOT-NULL columns absent from old archives. */
  readonly importFallbacks?: Readonly<Record<string,            // table
    Readonly<Record<string, unknown | ((row: Row) => unknown)>>>>; // column
  /** v2: reshape old-archive rows (rename / split / move / drop). */
  readonly importTransforms?: readonly BackupImportTransform[];
}

export interface BackupImportTransform {
  /** Table name as it appears IN THE ARCHIVE (the old name). */
  readonly fromTable: string;
  /** Gate on archive age, e.g. journal position or column presence. */
  readonly appliesTo: (manifest: BackupManifest) => boolean;
  /** Map one old row to zero or more (table, row) outputs. */
  readonly apply: (row: Row, ctx: TransformContext) => readonly TransformedRow[];
}
```

- Transforms run in the Map stage, before column mapping, so a transform's
  output is itself checked against the live schema.
- `appliesTo` typically checks `manifest.schema.journal.lastIdx < N` or
  "archive has column X" — so a refactor ships its data-mapping rule in the
  same PR as the schema change, in the owning module's `<name>.backup.ts`.
- A transform claiming `fromTable` overrides the default "skip vanished
  table" rule: the old table's rows flow into their new home and are
  counted `transformed`.
- `ctx` exposes read-only live-DB lookups (e.g. resolve an id by unique
  name) and an id-mapping store shared across tables for split/move cases.

### Schema-mapping rules table

| # | Case (archive vs live schema) | Behavior | Reported as |
|---|---|---|---|
| 1 | Column in both, same name | Copy value (SQLite affinity applies) | (normal insert) |
| 2 | Column in archive, gone live, no transform claims it | Drop the value, keep the row | `droppedColumns[table][col]` count |
| 3 | Column new live, nullable or has DB default | Omit from insert; default/NULL applies | `defaultedColumns[table][col]` count |
| 4 | Column new live, NOT NULL, no default, `importFallbacks` entry exists | Fill from fallback | `defaultedColumns` (flagged `fallback`) |
| 5 | Column new live, NOT NULL, no default, no fallback | All rows of the table fail (cannot be satisfied) | table-level `error: missing-required-column` |
| 6 | Column in both, declared type differs | Copy as-is (SQLite is dynamically typed); flag | `warnings: type-changed` |
| 7 | Table in archive, gone live, no transform | Skip entire table | `skippedTables[]` |
| 8 | Table in archive, gone live, transform registered | Rows re-homed by transform | `transformed` counts on target table |
| 9 | Table live, absent from archive | Untouched (merge never deletes) | (not in report) |
| 10 | Module in archive unknown to the registry | Tables skipped | `skippedModules[]` |
| 11 | Row PK already exists live | Skip row | `skippedDuplicate` |
| 12 | Row FK target absent (live ∪ incoming) | Fail row before insert | `failed: missing-parent` |
| 13 | Non-PK unique violation on insert | Fail row | `failed: unique-conflict(<index>)` |
| 14 | `files` row: PK new but `(sha256, storageDriver)` exists | Skip row, remap incoming `file_references.fileId` old→existing id | `skippedDuplicate` (flagged `remapped`) |
| 15 | Value is the `[REDACTED]` sentinel (token export) | Insert verbatim; secret is unusable | `warnings: redacted-secrets` count |

Rule 14 is shipped as a built-in transform owned by the file module — it is
also the reference implementation showing module authors how to write one.

## Duplicate/conflict semantics (R3)

- **Merge mode (new default):** insert-in-dependency-order; PK probe →
  existing row wins, incoming row skipped, live data never modified or
  deleted. Child rows of a skipped parent proceed normally (the FK target
  exists — that is why the parent was skipped). Child rows of a *missing*
  parent (rule 12) fail individually.
- **Keyless tables:** duplicate detection uses the table's real primary key
  from drizzle introspection — single (`id`), non-`id` (e.g.
  `pkce_challenges.state`), or composite. A table with no PK at all falls
  back to its first unique index; with neither, rows are appended as-is and
  the table is flagged `no-key-append` in the report so the operator knows
  duplicates were possible.
- **Result report** (per table): `inserted`, `skippedDuplicate`,
  `droppedColumns`, `defaultedColumns`, `transformed`, `failed` (with up to
  100 sampled `{rowId, reason}` entries + total), plus archive-level
  `skippedTables`, `skippedModules`, `warnings`, and blob counts
  (`blobsWritten`, `blobsSkippedExisting`, `blobsFailed`) and the
  `reconcile` result (`checked`, `quarantined`).
- **Fate of v1 delete-then-insert:** kept, as the explicit
  `mode: "replace"` of the v2 apply call, reusing the existing
  `importJsonBackup` engine fed from the archive's NDJSON. Rationale:
  merge cannot produce an exact snapshot restore (it cannot remove rows
  created since the backup), and disaster recovery onto a polluted DB needs
  exactly that. Replace mode keeps the v1 guards verbatim: `includeUsers`
  handling, admin lock-out refusal, user-FK pre-flight, session revocation
  on role/status change. Replace mode additionally requires the archive
  schema to match the live journal position (no cross-schema replace —
  tolerant mapping plus wholesale deletion is too dangerous to combine).
  The v1 JSON routes (`POST /api/backup/import`, `POST /api/backup/export`)
  remain for one release for existing `.json` files and automation, are
  marked deprecated in `docs/modules/backup.md`, and removal is a follow-up
  decision (see Open questions).

## Error & edge cases

- **Crash mid-export:** `.partial` file + `tmp/` are unreferenced after
  restart; TTL sweep removes them. Poll of the lost job returns 404.
- **Crash mid-apply:** the merge transaction rolls back atomically (no
  partial table writes). Blob writes already made are harmless: content-
  addressed objects without rows are exactly what the existing
  unreferenced-files GC tolerates; re-apply skips them via `exists`.
- **Apply called twice / double-click:** import job state machine rejects
  `apply` unless state is `validated`; re-running a completed merge is a
  no-op by construction (all PKs duplicate) but is still refused for
  clarity.
- **Archive references blobs it does not contain** (exported with
  `includeBlobs: false`, or blob source was quarantined): rows import,
  reconcile quarantines what is missing — same behavior and messaging as
  v1, surfaced in the report.
- **Blob present but no `files` row references it:** skipped, counted in
  `warnings` (defends against smuggling unrelated bytes into storage).
- **Hash mismatch between blob path and content:** blob rejected,
  `blobsFailed`, row left to reconcile/quarantine.
- **Empty module selection / unknown module names:** 400, mirrors v1.
- **Concurrent imports:** one staged import may be in `applying` at a time
  (process-wide guard); a second `apply` gets 409.
- **Disk exhaustion while staging:** job fails with a clear error; partial
  files removed by cleanup/sweep; caps make the required headroom
  predictable (compressed cap + decompressed cap).
- **Old archive, table renamed AND new NOT NULL column added:** transforms
  run first (rule 8), then fallbacks (rule 4) — the combination is the
  expected refactor path and is covered by a dedicated test.

## Security (R6)

- **Access:** every v2 admin route under `authRequired` + `adminRequired`,
  same as v1. Token routes use the existing `serviceTokenRequired("backup")`
  middleware, keep the fail-closed explicit module scope, the per-token
  in-flight semaphore, and the min-interval gate; token archives are always
  **redacted** and only token-created jobs are visible to token callers.
- **Redaction parity:** the v1 `SECRET_FIELD_NAMES` set (token, password,
  secret, accessToken, refreshToken, codeVerifier, taskConfig) is moved to
  a shared constant and applied per-row when writing NDJSON for token
  exports; `manifest.redacted: true`. Admin exports stay unredacted
  (restore-complete path), unchanged from v1 policy.
- **Upload caps:** compressed size cap (`BACKUP_IMPORT_MAX_ARCHIVE_BYTES`,
  default 2 GiB) enforced on Content-Length *and* on counted bytes while
  streaming (Content-Length can lie).
- **Decompression-bomb defence:** while streaming through
  `DecompressionStream`, enforce (a) total decompressed byte cap, (b)
  per-entry caps — NDJSON entries capped by the row-count and string-length
  caps inherited from v1, blob entries by `BACKUP_IMPORT_MAX_BLOB_BYTES`
  and by the manifest-declared `files.size` — and (c) a tar entry-count cap
  (default 100k). Exceeding any cap aborts the upload immediately.
- **Zip-slip / path traversal:** entry names are validated against the
  strict allowlist grammar (see Import stage 1) **before** any path use;
  blob writes never use the tar path directly — the storage key is
  re-derived as `deriveStorageKey(sha)` from the validated hash, and the
  sha is verified against the streamed content. Symlinks, hardlinks,
  devices, and directories with payloads are rejected. Nothing from the
  archive is ever written outside `backup-staging/<id>/` or the storage
  driver.
- **SQL safety:** rows flow exclusively through drizzle parameterized
  inserts (as v1); `assertIdShape` keeps id-like fields in the URL-safe
  alphabet.
- **Audit events:** reuse and extend the v1 vocabulary —
  `backup.export` (job created; detail: modules, includeBlobs, via),
  `backup.export.download`, `backup.import.validate` (upload + dry-run),
  `backup.import.apply` (detail: mode, per-table summary counts),
  plus the existing per-user `user.restored` rows in replace mode. All
  written with the v1 `critical: true` flag so a failed audit write fails
  the action.
- **CSRF / transport:** routes live under the existing protected router and
  inherit its session/CSRF handling; download responses set
  `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` like v1.

## Admin web UI (R5)

New "Backup" tab in Admin Settings, registered in
`apps/web/src/app/routes/_app/admin/settings.lazy.tsx` next to the existing
tabs, implemented as `-settings-backup.tsx` following the established
`-settings-*.tsx` colocation pattern (`-settings-about.tsx` is the closest
read-only-plus-actions template; `-settings-ship.tsx` shows the heavier
form/table patterns).

Export side:

- Module multi-select sourced from `GET /api/backup/modules` (checkbox list
  with dependency hint text), "Include file blobs" switch, Generate button.
- While a job runs: progress from polling `GET /v2/exports/:jobId` with
  TanStack Query `refetchInterval` (the codebase's existing polling
  pattern); cancel button → `DELETE`.
- On completion: archive size + Download button (plain anchor to the
  download route); the list shows at most the current/last job (in-memory
  job model keeps this deliberately minimal).

Import side:

- Upload via the shared `FileUploadButton`
  (`apps/web/src/shared/components/file/`) with
  `acceptOverride=".tar.gz,application/gzip"`.
- After upload: render the dry-run report — summary cards (rows to insert /
  duplicates to skip / failures) + a per-table table reusing the shared
  table primitives used across admin pages, with expandable
  dropped-column / transform / warning detail.
- Apply requires an explicit confirm step: shadcn `AlertDialog`; replace
  mode adds the v1-style destructive confirmation (type-to-confirm) and the
  `includeUsers` switch.
- Final result report rendered with the same report component; errors
  surface via the standard toast + inline error patterns.

i18n: new `settings:backup.*` keys in both `apps/web/src/locales/en` and
`zh`, passing the existing i18n parity check. Status/report enums map to
translated labels (`reasons.missing-parent`, etc.).

## Testing strategy

API (bun:test, colocated like the existing backup tests):

- **Archive writer:** manifest correctness (columns/PK/journal from a real
  test DB), NDJSON row fidelity vs v1 exporter output, blob dedup (two
  `files` rows sharing one sha → one tar entry), all three `blobs` modes
  (R7: separate mode yields a blob-free data archive + a blobs-only
  archive matching `expectedBlobs`; `expectedBlobs` present in every
  mode), the `includeBlobs` alias mapping.
- **Round trip:** export → import into an empty DB → table-by-table
  equality + blobs present on driver + reconcile finds zero quarantine.
- **Cross-schema fixtures:** build archives against synthetic "old" drizzle
  table defs, import into the live schema; one test per mapping rule
  (1–15), incl. the rename+NOT-NULL combination and the `files` sha-remap
  rule 14.
- **Merge semantics:** duplicate-PK skip, child-of-skipped-parent inserts,
  missing-parent fails, keyless table fallback, report counts exact.
- **Dry-run:** report equals a subsequent real apply's report; DB hash
  unchanged after dry-run.
- **Lifecycle:** download-then-cleanup (R7: per-artifact download, cleanup
  only after both artifacts in separate mode), TTL sweep (mtime-injected),
  `.partial` never downloadable, crash-sim (orphan dir) reclaimed.
- **Security:** path-traversal corpus (absolute, `..`, symlink, bad blob
  prefix), bomb caps (oversized entry, entry-count, lying Content-Length),
  token-route redaction + scope fail-closed + job visibility isolation,
  non-admin 403 on every route.
- **Replace mode:** v1 guard parity tests re-run through the v2 entry point
  (lock-out refusal, includeUsers FK pre-flight, session revocation),
  schema-position mismatch rejection.

Web (vitest): tab renders module list; generate→poll→download happy path
(mocked queries); dry-run report rendering incl. failures; confirm dialog
gates apply; replace-mode destructive confirm; i18n keys exist in en+zh.

Gate: `bun run check` green per phase (lint, typecheck, api + web tests,
build, i18n parity, env-docs, api-docs).

## Phased implementation breakdown

Each phase is separately mergeable and leaves `bun run check` green.

1. **Phase 1 — Archive writer + export job lifecycle.**
   New `archive.service.ts` (tar.gz writer, manifest builder),
   `export-job.service.ts` (job map, staging dirs, state machine, TTL
   sweep), v2 export routes (admin trigger/status/download/delete).
   Dependency: add `tar-stream`.
   Verify: writer + lifecycle + security(download) tests; manual export of
   a seeded DB downloads and `tar -tzf` lists manifest-first layout.
2. **Phase 2 — Archive reader + validation + mapping engine + dry-run.**
   `import.service.ts` stages uploads, validates (allowlist grammar, caps),
   builds the mapping against the live schema, runs the rollback-dry-run,
   returns the report. Routes: upload + status + delete. No write path yet.
   Verify: mapping-rule tests 1–13 (dry-run only), security upload corpus.
3. **Phase 3 — Merge apply + blob import + reconcile + replace mode.**
   Merge transaction engine, blob streaming into the active driver,
   `reconcileRestoredFiles` wiring, apply route with
   `mode: merge|replace` (replace delegates to the v1 engine + guards),
   final report persistence, audit events.
   Verify: round-trip, merge-semantics, replace-parity, crash/idempotence
   tests.
4. **Phase 4 — Transform hook registry + file sha-remap + module-author
   docs.** Extend `BackupContribution` (`importFallbacks`,
   `importTransforms`), execute transforms in the Map stage, ship rule 14
   as the file module's built-in transform, document the authoring pattern
   in `docs/develop/module/standards.md` §2.8 and refresh
   `docs/modules/backup.md`.
   Verify: rule 8/14 tests, rename+fallback combination test, docs checks.
5. **Phase 5 — Admin Settings Backup tab.** `-settings-backup.tsx`,
   export/import flows, dry-run + result report rendering, confirm dialogs,
   `settings:backup.*` en+zh.
   Verify: web tests above; manual pass on `bun run dev:all`.
6. **Phase 6 — Token-route parity + deprecation notes.** Token job
   trigger/status/download with redacted NDJSON writer, shared
   `SECRET_FIELD_NAMES` extraction, deprecation banner for v1 JSON routes
   in docs, env-docs entries for the new config keys.
   Verify: token redaction/scope/visibility tests; full `bun run check`.

## Open questions

1. **Tar library final pick:** `tar-stream` is the working choice
   (streaming, no-FS, battle-tested). Validate at Phase 1 that it runs
   cleanly under Bun 1.3 (it is plain JS, expected yes); fallback candidate
   is `nanotar` (zero-dep, smaller, less battle-tested).
2. **v1 JSON route removal timing:** keep both JSON routes for one release
   after v2 ships, then remove, or keep the token JSON export indefinitely
   for lightweight row-only automation? Needs an operator decision before
   Phase 6.
3. **Schema snapshot in archive:** should the archive also embed
   `drizzle/meta/<idx>_snapshot.json` for forensic diffing (bigger archive,
   richer offline tooling)? Not needed for the mapping engine — manifest
   columns suffice — so deferred unless a concrete need appears.
4. **Per-token module-scope binding** (v1 leftover noted in
   `export.routes.ts`): binding allowed modules to the token itself still
   needs a config schema change; v2 inherits the fail-closed request scope
   but does not solve this.
5. **Progress granularity:** is per-table + blob-bytes progress enough for
   the UI, or do operators need per-table row progress? Start coarse;
   refine after first use.

## Annotations

- 2026-06-10: Drafted after investigating the v1 backup module
  (registry/export/restore), the content-addressed file storage layer, the
  drizzle migration journal, and the admin settings tab patterns. Design
  only — implementation is not approved yet.
- 2026-06-10: Phase 1 shipped (archive writer, export job lifecycle, v2
  admin export routes, `BACKUP_STAGING_TTL_HOURS`). Open question 1
  resolved: **tar-stream 3.2.0 validated under Bun 1.3.14 — yes**, pinned
  exactly; no fallback to nanotar needed. One Bun caveat: `Readable.toWeb`
  rejects tar-stream's streamx readable ("QueuingStrategyInit.highWaterMark
  member is required"), so the writer bridges node→web streams via the
  async-iterator protocol (pull-based, backpressured) before piping through
  `CompressionStream("gzip")`. Blob-dedup note: the live schema's
  `UNIQUE(sha256, storage_driver)` means duplicate-sha `files` rows can
  only exist across drivers; the dedup test exercises that shape.
- 2026-06-10: **R7 scope add (user requirement, binding) — separate blob
  export.** Phase 1 amended: export trigger takes
  `blobs: "embedded" | "separate" | "none"` (default embedded;
  `includeBlobs` kept as deprecated alias), separate mode emits
  `archive.tar.gz` + `blobs.tar.gz` as two independently downloadable
  artifacts, manifest gains `blobsMode` + `expectedBlobs` in all modes,
  download route gains `?artifact=data|blobs`, and `downloaded` + staging
  cleanup fire only after every artifact has been downloaded. The new
  manifest fields are optional in the TS type (the Phase-2 importer and
  its fixtures predate them) but the exporter always writes them; import
  side adopts them with Phase 3, UI with Phase 5. See "R7 — Separate blob
  export".
- 2026-06-10: **Phase 3 shipped (+ the R7 import side).** Merge apply lifts
  the Phase-2 dry-run row loop into a committed synchronous transaction
  (one shared engine, so dry-run report == apply report by construction);
  `POST /v2/imports/:importId/apply` (`mode: merge | replace`, 202 + poll,
  state machine `validated → applying → completed | failed`, process-wide
  one-applying guard → 409); blob import stage (second streaming pass,
  `exists` skip, sha recomputed while streaming, write only on match) with
  `expectedBlobs`/`blobsMode`-driven reporting that distinguishes
  expected-in-separate-archive from genuinely-missing; new un-quarantine
  pass + `reconcileRestoredFiles` close the loop (replace mode reconciles
  before blobs arrive, so arrived bytes heal quarantined rows). Replace
  mode delegates to the v1 `importJsonBackup` engine with the v1 guards
  replicated verbatim (includeUsers, lock-out refusal, user-FK pre-flight,
  session revocation, per-user `user.restored` audits) plus the
  journal-position equality gate (`REPLACE_SCHEMA_MISMATCH`). Standalone
  `POST /v2/blob-restores` ships per the R7 design (blobs-only allowlist,
  caps, cross-endpoint rejection both ways). Manifest `blobsMode` +
  `expectedBlobs` are first-class on import; legacy archives default to
  the `includeBlobs` alias and an unknown expected list. Audits:
  `backup.import.apply`, `backup.import.blobs` (both critical). Transform
  seams in `import-mapping.ts` untouched — Phase 4.
- 2026-06-10: **Phase 4 shipped.** `BackupContribution` gains
  `importFallbacks` + `importTransforms` per the R2 contract (registry
  collects them by table; `appliesTo` is gated in the engine against the
  staged manifest). Transforms run in a pre-pass inside the shared merge
  transaction — before column mapping and before any insert, so
  `ctx.lookup` observes the pre-import DB state and dry-run==apply parity
  holds by construction; a claimed vanished table re-homes its rows
  (rule 8, counted `transformed` on the target), fallbacks fill NEW
  NOT-NULL columns at the rule-4 seam (counted `defaultedColumns`, flagged
  `fallbackColumns`), and the rename+NOT-NULL combination works
  transforms-first-then-fallbacks. Rule 14 ships as the file module's
  built-in transform pair (`files` sha-dedupe consume + remap via the
  shared id-mapping store, `file_references.fileId` rewrite), reported as
  `skippedDuplicate` flagged `remapped`. Engine call sites
  (`import.service.ts`, `import-apply.ts`) unchanged — hooks are collected
  from the registry inside the engine. Docs: standards.md §2.8 authoring
  guide + backup.md v2 refresh (no v1 deprecation banners — Phase 6).
