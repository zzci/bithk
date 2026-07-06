# REFACTOR-038 - Hour-based storage key layout (YYYYMMDDHH/<ulid>, UTC)

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

Storage keys move from content-addressed `ab/cd/<sha256>` to `YYYYMMDDHH/<ulid>` — UTC
upload hour + the `files.id` ULID (e.g. `2026070609/01JZC9ZJ8...`). Readable, hour-bucketed,
short. Existing objects are NOT migrated now (CHORE-004 script later); they keep serving
through their stored `files.storage_key`.

## Design

- `storage/key.ts`: `newStorageKey(id, nowMs)` replaces `deriveStorageKey(sha256)`.
- Keys are minted once at upload time and persisted; nothing derives a key from sha256
  anymore. Dedup stays `UNIQUE(sha256, storage_driver)` — a duplicate upload reuses the
  existing row/key, so one object per content per driver is preserved.
- Direct upload: presign mints `{id, key}` and parks it in an in-process pending registry
  (TTL-swept); confirm consumes it for `stat` + `registerUploadedBlob` (row id = presigned
  ULID). API restart drops pending entries → confirm 400s and the client re-uploads.
- `syncNonSpreadsheetsToS3` mints a fresh hour key per moved row.
- Backup: v2 manifests record `storageKey` per expected blob; import dry-run existence
  checks, archive blob import, standalone blob restore, and quarantine rescan all resolve
  keys from `files` rows / the manifest instead of deriving; legacy archives without
  per-blob keys fall back to the content-addressed derivation.
- Preview cache paths (sha-based, local cache) are unrelated and unchanged.
