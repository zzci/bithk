# Backup Module

Database export / restore scoped to selected data modules with dependency
resolution. One format is served:

- **v2 (PLAN-075 + FIX-062)** — streaming `.tar.gz` archives (manifest-first
  layout: `manifest.json`, `data/<table>.ndjson`) with export jobs, staged
  imports, an exact rollback dry-run, cross-schema mapping, transform hooks,
  and a non-destructive **merge** apply — optionally **wipe-before-merge**
  (FIX-061) for a conflict-free full restore. **Merge is the only apply mode.**
  The v1-engine replace mode was removed in FIX-062 (wipe+merge supersedes it
  without the exact-journal schema gate); `mode: "replace"` answers
  `400 REPLACE_MODE_REMOVED`.
- **v1** — the single-request JSON export / delete-then-insert import routes
  were retired in FIX-072 (see [v1 route removal](#v1-json-route-removal)).
  `export.service.ts` / the v1 half of `restore.service.ts` survive only as
  the round-trip harness of the module backup tests.

## Format version 3 — a one-time epoch reset (PLAN-108)

`BACKUP_FORMAT_VERSION` is **3**. This is **not** an incremental format change:
the tar / manifest / NDJSON framing is byte-for-byte what 2 was. The bump is an
**epoch marker** for the projects-as-sections schema reset
([ADR-015](../decisions/015-projects-as-sections.md)) — it exists solely so the
manifest's exact-match version gate refuses every pre-reset archive, whose rows
describe a schema that no longer exists and cannot be migrated onto this one.

What the gate does, in `parseManifest`:

| Manifest `formatVersion` | Result |
|---|---|
| `> 3` | `400 UNSUPPORTED_VERSION` — "newer than this build supports … upgrade the server before importing." |
| `< 3` (i.e. any pre-fold archive) | `400 INVALID_FORMAT` — names the reset and states the only remaining option: **run a pre-reset build of the server against a copy of that deployment and read the data there.** |
| `3` | Proceeds to the shape check. |

The gate runs inside `readAndValidateArchive`, which `prepareImport` calls at
**upload / staging time** — before the dry-run and long before any apply. Since
merge is the only apply mode, that single check covers every path: there is no
second, replace-specific gate to keep in sync.

**The reset is irreversible.** Pre-fold archives cannot be imported, converted
or partially salvaged. Take a fresh archive immediately after cutting over.

### Contribution regrouping in this release

- `project_sections` joins the **`projects`** contribution (it FKs
  `project_id`, so it trails `projects`). These are the rows that give a
  restored project its tabs — an archive without them restores projects with no
  sections mounted.
- `procurement_categories` and `global_procurement_categories` move from the
  `projects` contribution to **`procurement`**: they are procurement-domain
  data. The importer maps rows by table name, so the move is transparent for
  post-fold archives (proven by a round-trip test, not assumed). `procurement`
  already deps on `projects`, so per-project category rows still restore after
  the `projects` rows their `project_id` points at.
- The `ships` contribution keeps its name but now carries `ship_profiles`,
  `ship_equipment_categories`, `ship_equipment`, `worklists` and the two global
  vocabularies — all keyed by `project_id`.
- **The `projects <-> ships` dependency cycle is gone.** With
  `projects.ship_id` removed, `projects` deps are `["users", "tags"]` and
  `ships` deps are `["users", "projects"]` — a one-way edge. The cycle-tolerant
  resolver (visiting-set guard) and the `PRAGMA defer_foreign_keys = 1` restore
  transaction stay in place and are still correct; they are simply no longer
  load-bearing here. See [ADR-004](../decisions/004-ship-project-cycle-and-restore.md)
  (superseded).

## File story (FIX-062): DB backup + storage tree/bucket copy

Backups carry **database data only** (`manifest.blobsMode: "external"`).
Uploaded file bytes are the operator's responsibility:

- **local driver** — copy the storage tree (`FILE_STORAGE_LOCAL_ROOT`,
  hour-bucketed `YYYYMMDDHH/<ulid>`; blobs from before REFACTOR-038 sit at
  the legacy `ab/cd/<sha256>` paths) alongside the archive;
- **s3 driver** — back up / point at the bucket.

Each `files` row records its blob's key in `storage_key` (and the manifest
mirrors it in `expectedBlobs[].storageKey`), so DB rows and storage paths
always correspond — restoring bytes to the same relative path is sufficient.
After an import, `files` rows whose bytes are absent are **quarantined**
(`storage_driver = quarantined:…`): downloads answer a clean
`404 FILE_CONTENT_UNAVAILABLE`, never a 500, and the row is preserved. Rows
heal through a **rescan** (only quarantined rows are probed):

- automatically at the end of every import apply ("copy the storage tree
  first, then import" needs zero extra steps);
- `POST /api/backup/v2/blob-rescans` / the admin panel's "Rescan missing
  files" button;
- CLI `backup:blob-rescan` (offline runtime).

Legacy blob-bearing archives (`embedded` / `separate`) still import their
bytes, and the `blobs.tar.gz` restore endpoint keeps working — only the
*production* of blob-bearing archives was removed.

## File layout

```text
apps/api/src/modules/backup/
  backup.routes.ts        # aggregator: mounts the v2 routers + /backup/modules
  registry.ts             # self-registration API (BackupContribution, transform/fallback hooks)
  archive.service.ts      # v2 tar.gz writer + manifest builder
  export-job.service.ts   # v2 export job state machine, staging dirs, TTL sweep
  export-v2.routes.ts     # v2 export trigger/status/download/delete (admin)
  export-v2-token.routes.ts  # v2 service-token export trigger/status/download
  secret-fields.ts        # shared SECRET_FIELD_NAMES + redaction walk
  import.service.ts       # v2 archive staging, validation, dry-run, job map
  import-mapping.ts       # live-schema view, mapping rules 1-15, merge engine
  import-apply.ts         # v2 apply: merge txn + blob import + rescan + reconcile
  import-v2.routes.ts     # v2 upload/status/apply/delete
  blob-restore.ts/.routes.ts  # legacy blobs-only archive restore + quarantine rescan
  export.routes.ts        # GET /backup/modules (the v1 export routes are gone)
  export.service.ts       # v1 JSON dump writer — test harness only (FIX-072)
  restore.service.ts      # assertSane / caps / reconcileRestoredFiles (live) + v1 importer (harness only)
  index.ts
```

## Database

No own tables. Each data-bearing module declares a `BackupContribution` from
its own `<module>.backup.ts` and registers it from its `index.ts`. The backup
module never imports module schemas — it only enumerates whatever modules
have registered themselves at boot, and introspects their drizzle tables for
the live-schema view.

See [`develop/module/standards.md` §2.8 — Backup contribution](../develop/module/standards.md#28-backup-contribution-mandatory-for-modules-that-own-tables)
for the rules new modules must follow, including the v2 import hooks
(`importFallbacks`, `importTransforms`).

## Routes

Mounted under `protectedRoutes`. All v2 routes require admin except the
`*-via-token` trio, which accepts a service token (`SERVICE_TOKEN_BACKUP`)
instead of a session cookie.

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/backup/modules` | Admin | Lists data-module names available for backup. |
| POST | `/api/backup/v2/exports` | Admin | Start an archive export job (`modules`). Archives are DB data only (`blobsMode: "external"`); a legacy `blobs`/`includeBlobs` field is ignored. |
| GET | `/api/backup/v2/exports/:jobId` | Admin | Job status + progress + per-artifact sizes. |
| GET | `/api/backup/v2/exports/:jobId/download?artifact=data` | Admin | Stream the finished data artifact (no blobs artifact is produced anymore). Staging is cleaned after download. |
| DELETE | `/api/backup/v2/exports/:jobId` | Admin | Cancel a running job / discard a finished one. |
| POST | `/api/backup/v2/imports` | Admin | Upload an archive; validates (format version **exact-match 3**, allowlist grammar, size/entry caps) and runs the rollback dry-run; returns the report. A pre-reset archive is rejected here with `400 INVALID_FORMAT`. |
| GET | `/api/backup/v2/imports/:importId` | Admin | Staged import status + dry-run / final report. |
| POST | `/api/backup/v2/imports/:importId/apply` | Admin | Apply with `{ wipeExisting? }` (merge is the only mode; `mode: "replace"` answers `400 REPLACE_MODE_REMOVED`). A web wipe re-binds the operator's session to the restored admin inside the same transaction, so the cookie survives. |
| DELETE | `/api/backup/v2/imports/:importId` | Admin | Discard a staged import. |
| POST | `/api/backup/v2/blob-restores` | Admin | Upload a legacy blobs-only archive (R7 `separate` mode): verifies hashes, writes missing blobs to the active driver, un-quarantines healed `files` rows. |
| POST | `/api/backup/v2/blob-rescans` | Admin | Probe quarantined `files` rows against the storage backend and heal rows whose blob is back (`{ scanned, healed, stillMissing }`). |
| POST | `/api/backup/v2/exports-via-token` | Service Token | Token parity for the export trigger: explicit module scope required (fail closed), archive always **redacted**, per-token semaphore + min-interval gate apply, plus the process-wide one-running guard. |
| GET | `/api/backup/v2/exports/:jobId/status-via-token` | Service Token | Poll a job created by the same token bucket (admin jobs are invisible — 404). |
| GET | `/api/backup/v2/exports/:jobId/download-via-token?artifact=data` | Service Token | Download an own-bucket job's artifact; same lifecycle as the admin route. |

### v1 JSON route removal

The three v1 JSON routes (`POST /api/backup/export`,
`POST /api/backup/export-via-token`, `POST /api/backup/import`) were
deprecated with backup v2 (PLAN-075, 2026-06-10) and **removed in FIX-072**;
they now answer `404`. The v1 importer had no PLAN-108 format-epoch gate and
kept the delete-then-insert engine, so it was the one import path the epoch
check did not cover. Replacements:

| Retired v1 route | v2 replacement |
|---|---|
| `POST /api/backup/export` | `POST /api/backup/v2/exports` (+ status/download) |
| `POST /api/backup/export-via-token` | `POST /api/backup/v2/exports-via-token` (+ `status-via-token` / `download-via-token`) |
| `POST /api/backup/import` | `POST /api/backup/v2/imports` + `.../apply` (merge; add `wipeExisting: true` for a conflict-free full restore) |

Existing `.json` dumps can only be read by a pre-FIX-072 build.

Token-route visibility: token-created v2 jobs are owned by their token
bucket — only the creating bucket can poll/download them, while admin
routes see every job. Admin v2 exports stay **unredacted** (the
restore-complete path, v1 policy parity); token exports scrub
`SECRET_FIELD_NAMES` (shared constant in
`apps/api/src/modules/backup/secret-fields.ts`) per NDJSON row and set
`manifest.redacted: true`.

## Merge semantics (v2 apply)

One synchronous committed transaction, tables in registry dependency order;
the upload-time dry-run runs the identical row loop in a transaction that
always rolls back, so the dry-run report exactly equals the apply report.

- Existing row (by real PK, else first unique index) wins — incoming row
  skipped (`skippedDuplicate`); live data is never modified or deleted.
- Archive-only columns are dropped per row; new live columns take their
  default/NULL, or a module `importFallbacks` value (see below), else the
  table fails with `missing-required-column`.
- Application-level FK pre-check fails rows as `missing-parent` before SQL;
  non-PK unique violations fail per-row as `unique-conflict(<index>)`.
- `files` special case (rule 14): an incoming `files` row whose PK is new but
  whose `(sha256, storageDriver)` already exists live is skipped
  (`skippedDuplicate`, flagged `remapped`) and incoming
  `file_references.fileId` values are redirected to the existing live id —
  shipped as the file module's built-in import transform.
- After the merge commits: blobs stream from legacy blob-bearing archives
  into each row's stored `storage_key` (already-present keys skipped, hashes
  verified while streaming; entries no row references are skipped), a
  quarantine **rescan** heals rows whose bytes are already on
  the storage backend, and `reconcileRestoredFiles` quarantines any `files`
  row whose bytes are still missing.
- Report per table: `inserted`, `skippedDuplicate` (+`remapped`),
  `transformed`, `droppedColumns`, `defaultedColumns` (+`fallbackColumns`),
  `failed` (sampled reasons); archive-level `skippedTables`,
  `skippedModules`, `warnings`, blob, rescan and reconcile counts.

## Cross-schema transform hooks (v2)

Old archives import into a newer live schema through two optional
`BackupContribution` fields, both owned by the module that owns the tables:

- `importFallbacks` — fill values (constants or `(row) => value` functions)
  for NEW NOT-NULL no-default columns absent from old archives (rule 4;
  counted in `defaultedColumns`, flagged in `fallbackColumns`).
- `importTransforms` — reshape archive rows before column mapping (rename /
  split / move / drop, rules 8 and 14). A transform claiming a vanished
  archive table overrides the skip rule: its rows are re-homed and counted
  `transformed` on the target table. `appliesTo(manifest)` gates each
  transform on archive age (typically `manifest.schema.journal.lastIdx`).
  Transforms run identically in dry-run and apply; lookups observe the
  pre-import DB state.

Authoring guide: [`develop/module/standards.md` §2.8](../develop/module/standards.md#28-backup-contribution-mandatory-for-modules-that-own-tables).
Reference implementation: `apps/api/src/modules/file/file.backup.ts`.

## Audit

`backup.export` (v1 + v2 job creation), `backup.export.download`,
`backup.import.validate` (upload + dry-run), `backup.import.apply`,
`backup.import.blobs` (blob restore), `backup.blob.rescan`,
`backup.import` (v1). All critical — a failed audit write fails the action.

## Out of scope

- Incremental / differential backups.
- Scheduled / off-site backups.
- Real-time replication.
