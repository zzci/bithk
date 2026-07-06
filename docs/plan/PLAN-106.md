# PLAN-106 - Unified S3 direct upload + hour-based storage key layout

- Status: Completed
- Tasks: [FIX-064](../task/FIX-064.md), [REFACTOR-038](../task/REFACTOR-038.md),
  [FEAT-050](../task/FEAT-050.md), [FEAT-051](../task/FEAT-051.md), [CHORE-004](../task/CHORE-004.md)
- Campaign: interactive session, direct on main
- Created: 2026-07-06
- Source: user report (production): S3 configured but uploads still proxied; storage keys
  hard to manage. Approvals 2026-07-06: unify the storage model, hour-based key layout
  (UTC, ULID object names), no migration of existing objects now (script later), release
  a new version when done.

## Context

Presigned direct upload (FEAT-044) exists but only for drive uploads, and its frontend
`postJson` helper double-prefixes `/api` → every presign request 404s, so direct upload
has never worked in production (masked in dev where the driver is `local` and
`directUpload=false`). All non-drive surfaces (item/comment attachments, covers/avatars,
HR colleague docs) are server-proxied multipart. Storage keys are content-addressed
(`ab/cd/<sha256>`), which the owner finds unmanageable in the bucket.

## Scope

In:
- FIX-064: fix the `/api/api/...` double prefix in `upload-queue.ts` `postJson`.
- REFACTOR-038: storage keys become `YYYYMMDDHH/<ulid>` (UTC upload hour + files.id).
  Key minted at upload, persisted in `files.storage_key`; all derive-from-sha call sites
  (upload, presign/confirm, S3 sync, backup import/blob-restore/rescan) switch to
  row-stored keys. In-memory pending-presign registry bridges presign→confirm.
  Backup manifests record per-blob `storageKey`; legacy archives fall back to the
  derived content-addressed key.
- FEAT-050: generic `/files/presign-upload` + `/files/confirm-upload` endpoints with a
  per-ownerType authorizer registry (item attachments, comment attachments, HR colleague
  docs, contact avatar, ship/project covers, admin default cover); shared frontend
  direct-upload helper with multipart fallback; existing multipart routes stay as the
  fallback path.
- Release: changelog + version bump after `bun run check` is green.

Out:
- Migrating existing `ab/cd/<sha256>` objects (CHORE-004, later script; old blobs keep
  serving via their stored keys).
- Univer sheets stay on the `db` driver (live-editable snapshot by design).
- Streaming/multipart S3 uploads, download Content-Disposition presign.

## Verification

- `bun run check` green (lint, typecheck, api+web tests, build, i18n, docs/spec/type gates).
- New unit tests: key shape, pending-presign registry, generic presign/confirm authz +
  FIX-048 cross-user rejection, upload-queue URL regression, backup restore with stored keys.
