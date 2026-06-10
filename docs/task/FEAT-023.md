# FEAT-023 - Backup module v2: cross-schema tar.gz export/import

- Status: Planned
- Plan: [PLAN-075](../plan/PLAN-075.md)
- Campaign: bqnuoyra/wktf3nhs
- Owner: (unassigned)
- Created: 2026-06-10

## Summary

Upgrade the backup module to a staged `.tar.gz` archive format that bundles
table rows (per-table NDJSON), schema metadata (`manifest.json` with per-table
columns and the drizzle journal position), and content-addressed file blobs.
Replace the import path with a tolerant cross-schema **merge** importer:
archives exported from an old schema import into the new live schema via
column-level mapping and per-module transform hooks, rows whose primary key
already exists are skipped, and a dry-run report precedes any write. Admin
Settings gains a Backup tab for both flows.

## Acceptance Criteria

- Export produces a server-side staged `.tar.gz` (manifest + per-table NDJSON
  + `blobs/<ab>/<cd>/<sha256>`) through an async job with status polling,
  download, post-download cleanup, and a TTL sweep, as defined by
  [PLAN-075](../plan/PLAN-075.md).
- Import maps old-schema archives onto the live schema per the PLAN-075
  schema-mapping rules table, supports registered transform hooks, and offers
  a dry-run mode that writes nothing.
- Merge import inserts in dependency order, skips duplicate primary keys,
  never deletes live rows, and returns per-table counts (inserted /
  skipped-duplicate / dropped-columns / transformed / failed). The v1
  delete-then-insert path survives as explicit `replace` mode.
- Blob entries are written to the active storage driver with
  content-addressed skip; `reconcileRestoredFiles` runs as the final check.
- Admin Settings has a Backup tab (export multi-select + progress + download;
  import upload + dry-run preview + explicit confirm + result report) with
  en + zh i18n.
- Admin-only routes plus service-token export parity; upload caps, zip-slip
  and decompression-bomb defences, secret redaction parity, audit events.
- Focused API and web tests per the PLAN-075 testing strategy; `bun run
  check` passes per phase.

## Files in Scope

- `apps/api/src/modules/backup/**` (new v2 services and routes; registry
  extension)
- `apps/api/src/modules/file/file.backup.ts` (sha-conflict remap transform)
- `apps/api/src/config.ts` (staging/cap config keys)
- `apps/web/src/app/routes/_app/admin/settings.lazy.tsx`
- `apps/web/src/app/routes/_app/admin/-settings-backup.tsx` (new)
- `apps/web/src/shared/lib/api/backup*.ts`
- `apps/web/src/locales/{en,zh}/**`
- `docs/modules/backup.md`, `docs/develop/module/standards.md`,
  `docs/reference/api*.md`

## Dependencies

- Existing backup v1 module (registry, export/restore services).
- Content-addressed file storage driver layer (`modules/file/storage`).
- New npm dependency `tar-stream` (final pick re-validated in Phase 1).

## Status Notes

- 2026-06-10: Created with [PLAN-075](../plan/PLAN-075.md). Design only —
  implementation is not approved yet.
