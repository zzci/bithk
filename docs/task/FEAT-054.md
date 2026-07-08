# FEAT-054 - CLI to move Univer spreadsheets back onto the db driver

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

Univer spreadsheets (`application/x-univer-sheet`) are the live-editable
snapshot and must live on the `db` driver, but historical rows can sit on
`local`/`s3` (pre-db-driver, or restored from a backup). Add a CLI to
consolidate them back onto `db`. The `migrate-all-to-s3` sweep deliberately
skips spreadsheets, so they need their own migration.

## Design

- `syncSpreadsheetsToDb(db, { dryRun?, onProgress? })` in storage.service.ts:
  for every `UNIVER_SHEET_MIME` row not already on `db` (and not quarantined),
  read the bytes via its current driver, `put` to the `db` driver under a fresh
  hour-based key (original upload hour), repoint `storage_driver='db'` +
  `storage_key`, delete the old blob. Inverse of `syncNonSpreadsheetsToS3`.
- CLI `script:migrate-sheets-to-db` (registry + packaged scripts), `--dry-run`,
  exit 1 on any failure. The `db` driver is always available, so no storage
  config is required.

## Verification

- `storage.test.ts`: a local spreadsheet moves back to `db` (bytes intact, old
  local blob deleted) while a non-sheet local file is untouched; idempotent;
  dry-run touches nothing.
- `bun run check` green.
