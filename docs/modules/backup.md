# Backup Module

Database export / restore scoped to selected data modules with dependency
resolution. Two formats coexist:

- **v2 (PLAN-075)** — streaming `.tar.gz` archives (manifest-first layout:
  `manifest.json`, `data/<table>.ndjson`, `blobs/<ab>/<cd>/<sha256>`) with
  export jobs, staged imports, an exact rollback dry-run, cross-schema
  mapping, transform hooks, and a non-destructive **merge** apply (or the
  v1-engine **replace** mode for disaster recovery).
- **v1** — single-request JSON export / delete-then-insert import.

## File layout

```text
apps/api/src/modules/backup/
  backup.routes.ts        # aggregator: mounts v1 + v2 routers
  registry.ts             # self-registration API (BackupContribution, transform/fallback hooks)
  archive.service.ts      # v2 tar.gz writer + manifest builder
  export-job.service.ts   # v2 export job state machine, staging dirs, TTL sweep
  export-v2.routes.ts     # v2 export trigger/status/download/delete (admin)
  export-v2-token.routes.ts  # v2 service-token export trigger/status/download
  secret-fields.ts        # shared SECRET_FIELD_NAMES + redaction walk
  import.service.ts       # v2 archive staging, validation, dry-run, job map
  import-mapping.ts       # live-schema view, mapping rules 1-15, merge engine
  import-apply.ts         # v2 apply: merge txn + blob import + reconcile
  import-v2.routes.ts     # v2 upload/status/apply/delete
  blob-restore.ts/.routes.ts  # blobs-only archive restore (R7 separate mode)
  export.routes.ts / export.service.ts    # v1 JSON export (+ token route)
  restore.routes.ts / restore.service.ts  # v1 JSON import (also v2 replace engine)
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
`*-via-token` trio, which (like the v1 `export-via-token` route) accepts a
service token (`SERVICE_TOKEN_BACKUP`) instead of a session cookie.

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/backup/modules` | Admin | Lists data-module names available for backup. |
| POST | `/api/backup/v2/exports` | Admin | Start an archive export job (`modules`, `blobsMode: embedded\|separate\|none`; legacy `includeBlobs` alias accepted). |
| GET | `/api/backup/v2/exports/:jobId` | Admin | Job status + progress + per-artifact sizes. |
| GET | `/api/backup/v2/exports/:jobId/download?artifact=data\|blobs` | Admin | Stream a finished artifact; `blobs` exists only for `separate` mode. Staging is cleaned after every artifact is downloaded. |
| DELETE | `/api/backup/v2/exports/:jobId` | Admin | Cancel a running job / discard a finished one. |
| POST | `/api/backup/v2/imports` | Admin | Upload an archive; validates (allowlist grammar, size/entry caps) and runs the rollback dry-run; returns the report. |
| GET | `/api/backup/v2/imports/:importId` | Admin | Staged import status + dry-run / final report. |
| POST | `/api/backup/v2/imports/:importId/apply` | Admin | Apply with `{ mode: "merge" \| "replace", includeUsers? }`. Replace delegates to the v1 engine with its guards and requires a matching schema journal position. |
| DELETE | `/api/backup/v2/imports/:importId` | Admin | Discard a staged import. |
| POST | `/api/backup/v2/blob-restores` | Admin | Upload a blobs-only archive (R7 `separate` mode): verifies hashes, writes missing blobs to the active driver, un-quarantines healed `files` rows. |
| POST | `/api/backup/v2/exports-via-token` | Service Token | Token parity for the export trigger: explicit module scope required (fail closed), archive always **redacted**, v1 per-token semaphore + min-interval gate apply, plus the process-wide one-running guard. |
| GET | `/api/backup/v2/exports/:jobId/status-via-token` | Service Token | Poll a job created by the same token bucket (admin jobs are invisible — 404). |
| GET | `/api/backup/v2/exports/:jobId/download-via-token?artifact=data\|blobs` | Service Token | Download an own-bucket job's artifact; same `?artifact` selector and downloaded/cleanup lifecycle as the admin route. |
| POST | `/api/backup/export` | Admin | **Deprecated** v1: streams a JSON backup of selected modules. |
| POST | `/api/backup/export-via-token` | Service Token | **Deprecated** v1 JSON output, gated by `SERVICE_TOKEN_BACKUP`; always redacted. |
| POST | `/api/backup/import` | Admin | **Deprecated** v1: validates and applies a JSON backup (delete-then-insert). |

### v1 JSON route deprecation

The three v1 JSON routes (`POST /api/backup/export`,
`POST /api/backup/export-via-token`, `POST /api/backup/import`) are
**deprecated as of backup v2 (PLAN-075)** and kept for one release for
existing `.json` files and automation. Their behavior is unchanged. v2
replacements:

| v1 route | v2 replacement |
|---|---|
| `POST /api/backup/export` | `POST /api/backup/v2/exports` (+ status/download) |
| `POST /api/backup/export-via-token` | `POST /api/backup/v2/exports-via-token` (+ `status-via-token` / `download-via-token`) |
| `POST /api/backup/import` | `POST /api/backup/v2/imports` + `.../apply` with `mode: "replace"` (delete-then-insert parity) or `mode: "merge"` |

Removal timing is an open operator decision (PLAN-075 open question 2):
remove both JSON routes after one release, or keep the token JSON export
indefinitely for lightweight row-only automation. Until that decision
lands, do not build new automation against the v1 routes.

Token-route visibility: token-created v2 jobs are owned by their token
bucket — only the creating bucket can poll/download them, while admin
routes see every job. Admin v2 exports stay **unredacted** (the
restore-complete path, v1 policy parity); token exports scrub
`SECRET_FIELD_NAMES` (shared constant in
`apps/api/src/modules/backup/secret-fields.ts`) per NDJSON row and set
`manifest.redacted: true`.

## Merge semantics (v2 `mode: "merge"`)

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
- Blobs stream from the archive after the merge commits: existing
  content-addressed keys are skipped, hashes are verified while streaming,
  and `reconcileRestoredFiles` quarantines any `files` row whose bytes are
  still missing.
- Report per table: `inserted`, `skippedDuplicate` (+`remapped`),
  `transformed`, `droppedColumns`, `defaultedColumns` (+`fallbackColumns`),
  `failed` (sampled reasons); archive-level `skippedTables`,
  `skippedModules`, `warnings`, blob and reconcile counts.

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
`backup.import.blobs` (blob restore), `backup.import` (v1), plus per-user
`user.restored` rows in replace mode. All critical — a failed audit write
fails the action.

## Out of scope

- Incremental / differential backups.
- Scheduled / off-site backups.
- Real-time replication.
