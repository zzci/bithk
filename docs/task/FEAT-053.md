# FEAT-053 - One CLI to migrate all blobs onto S3 in the new layout

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

One command that does BOTH migrations in a single pass: move every local/db
blob to S3 AND re-key any S3 object still on the legacy `ab/cd/<sha256>` key to
the hour-bucketed `YYYYMMDDHH/<ulid>` layout. (Option 2 over the key-only
`script:rekey-legacy-blobs`.)

## Design

- `syncNonSpreadsheetsToS3` gains `{ dryRun?, onProgress? }` and a canonical-key
  check: a row is skipped only when it is ALREADY an S3 object at its canonical
  hour key (or a spreadsheet, or quarantined). So an S3 blob on a legacy key is
  re-keyed in place (put new key → repoint → delete old), and a local/db blob
  is moved to S3 — both in the same loop. Hour = the row-id ULID mint time
  (original upload hour), matching `script:rekey-legacy-blobs`.
- New registry CLI command `script:migrate-all-to-s3` (one file,
  `cli/script-migrate-all-to-s3.ts`) wraps it via `withRuntime`, refuses when
  S3 is unconfigured (exit 2), streams per-row progress, supports `--dry-run`,
  exit 1 on any failure.
- The admin "sync to S3" route keeps calling the same function (opts optional).

## Verification

- `storage.test.ts`: dry-run touches nothing; a legacy-key S3 object is
  re-keyed to the hour layout; local→S3 still works; spreadsheet skipped.
- CLI dry-run refuses without S3 configured (exit 2).
- `bun run check` green.
