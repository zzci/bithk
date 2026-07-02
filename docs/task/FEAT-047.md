# FEAT-047 Storage module: DB-configured multi-driver storage + admin management

- Status: Done
- Plan: [PLAN-101](../plan/PLAN-101.md)
- Owner: local-session
- Updated: 2026-07-02

## Goal

Created files (text / markdown / spreadsheet) and their versions are stored in
the database; uploaded files go to the configured driver (S3 or local); storage
is multi-driver (db / s3 / local coexisting, each served via its own driver);
storage configuration lives in the DB (not env) and is managed from a new admin
Storage module that also lists server files and syncs non-spreadsheet data to S3.

## Scope

See [PLAN-101](../plan/PLAN-101.md). Two coordinated parts delivered together:
storage core (`file_blob` + `db` driver + multi-driver serving + DB config) and
the admin Storage module (config page + file list + sync-to-S3).

## Acceptance

- Newly created text/md/spreadsheet content (and versions) is stored in
  `file_blob` (`storageDriver=db`) and served correctly — no S3/local blob.
- Uploaded files use the DB-configured upload driver (s3 or local, default local
  when unconfigured); env storage vars are no longer consulted.
- A file's bytes are served/deleted via its own `storageDriver` (db + s3 + local
  coexist without `FILE_BACKEND_MISMATCH`).
- Admin Storage page: choose s3/local + edit S3 params (secret write-only, never
  displayed, unchanged when left masked); paginated server file list; "Sync to
  S3" moves every non-spreadsheet file not on s3 to s3 and deletes the old copy,
  skipping spreadsheets.
- All admin storage routes require admin. `bun run check` EXIT 0.

## Notes

- No backward compatibility (dev reseed). Sync = move. Secret stored plain but
  masked on read (reuse settings `.secret` masking).
