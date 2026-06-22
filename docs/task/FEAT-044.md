# FEAT-044 - S3 storage driver with presigned direct upload + image preview cache

- Status: Completed
- Plan: [PLAN-096](../plan/PLAN-096.md)
- Campaign: local
- Owner: session
- Created: 2026-06-22

## Summary

Add an S3-compatible storage driver (default target **Cloudflare R2**) to the
file module, support **presigned direct upload** (browser → S3 via presigned
PUT, bypassing the API), and add an **image preview cache** that serves
Bun-generated WebP thumbnails so previews don't hit S3 on every open.

Delivered in three phases:

- **A — S3 driver + presigned download.** New `storage/s3.ts` driver (Bun native
  `S3Client`), S3 config, registration/setup. Uploads still flow through the API
  (`driver.put`); downloads/previews 302-redirect to a presigned S3 GET.
- **B — Presigned direct upload.** `presignUpload` driver capability +
  `POST /files/presign-upload` / `POST /files/confirm-upload`; client computes
  sha256 (dedup), uploads straight to S3, confirms. Async S3 orphan/oversize
  sweep.
- **C — Image preview cache.** `Bun.Image` WebP thumbnails cached on local disk
  keyed by `sha256` + width; image inline requests serve from cache (same-origin,
  `immutable`, `ETag`); full images read-through cached; non-images keep the 302.

## Locked Decisions

1. **Dedup integrity = trust the client sha256.** `confirm-upload` does a single
   `stat()` (existence + authoritative size for the row); no server-side re-hash.
2. **Size limit = S3-side + external scan.** A cheap advisory check on the
   client-declared size before presigning; the hard ceiling is enforced by the
   S3 backend config plus an async sweep that deletes unregistered/oversized
   objects past a TTL. No per-request server byte streaming for size.
3. **Preview cache = native Bun WebP thumbnails** (`new Bun.Image(bytes).resize(w).webp()`,
   verified working, ~9 KB from a 108 KB JPEG, zero external deps) + local cache.
4. **Default target = Cloudflare R2.** `FILE_S3_REGION=auto`, endpoint
   `https://<account>.r2.cloudflarestorage.com`, presign omits ACL (R2 rejects
   object ACLs), `force_path_style=false` (configurable for MinIO). Generic
   S3-compatible otherwise.

## Acceptance Criteria

- **A:** `FILE_STORAGE_DRIVER=s3` activates a working S3 driver (put/getStream/
  delete/exists/presignDownload) via `Bun.S3Client`; `setup()` validates required
  S3 config and fails fast when missing. With `FILE_PRESIGN_ENABLED=true`,
  `GET /files/:id/content` 302s to a presigned S3 GET. Local driver behaviour and
  all existing file tests unchanged. Unit tests for the driver (mocked/contract).
- **B:** New endpoints issue a presigned PUT for `deriveStorageKey(sha256)`
  (dedup-skip → instant `addReference` when the blob already exists), and confirm
  via `stat()` then insert `files` + `file_references`. Frontend upload path
  hashes the file and does presign→PUT→confirm with progress. An async S3 sweep
  removes unconfirmed/oversized objects. No DB migration.
- **C:** Image inline requests (`?thumb=<w>` whitelist) serve a cached WebP
  thumbnail; grid thumbnails use it; preview dialog uses full image (read-through
  cache). Responses carry `Cache-Control: private, max-age, immutable` + `ETag`.
- `bun run check` passes after each phase; api-docs/api-spec regenerated for the
  new routes.

## Files in Scope (indicative)

- API: `modules/file/storage/s3.ts` (new), `storage/types.ts` (presignUpload),
  `storage/registry.ts`/`index.ts` (register s3), `file.service.ts` +
  `file.routes.ts` (presign/confirm, thumbnail/cache serve), `preview-cache.ts`
  (new), `orphan-sweep.ts`/`gc.ts` (S3 sweep), `config/schema.ts` + `config.ts`
  (FILE_S3_*), `.env.example`, docs.
- Web: `shared/components/file/upload-queue.ts` (hash + direct upload),
  `shared/lib/file/index.ts` + thumbnail URL sites, `shared/lib/api/*`.
- Docs: `docs/modules/file.md`, `docs/reference/env-reference.md` (regen),
  `docs/changelog.md`, deployment note (R2 bucket + CORS).

## Dependencies

- Builds on the existing `FileStorageDriver` abstraction (FEAT pre-existing) and
  FIX-047 (`MAX_UPLOAD_MB`). Uses Bun 1.3.14 native `S3Client` + `Bun.Image`
  (no new npm deps). No DB migration.

## Status Notes

- 2026-06-22: Created and approved ("开工"). Investigation done (backend file/
  storage map, web preview/upload map, Bun S3 + Bun.Image probes). Implementing
  Part A first.
- 2026-06-22: **Part B complete** (presigned direct upload). Driver gains
  `presignUpload`/`stat`/`list`; S3 implements them. File-module primitives
  `directUploadAvailable`/`findStoredBlob`/`presignBlobUpload`/`statStoredBlob`/
  `registerUploadedBlob`. Drive `presignDriveUpload` (dedup-instant or presign) +
  `confirmDriveUpload` (stat → register → entry) via a shared `commitDriveFileEntry`;
  routes `POST /drive/files/{presign,confirm}-upload`; `/system/upload-limits`
  gains `directUpload`. S3 orphan sweep (`runS3OrphanSweepOnce`, wired into the GC
  loop, `FILE_S3_ORPHAN_TTL_HOURS`). Web `upload-queue.ts` hashes (`crypto.subtle`)
  and does presign→PUT→confirm with progress, feature-detected. Tests:
  `drive.direct-upload.test.ts` (6 pass). api-docs/spec regenerated (315/202). No
  migration. `bun run check` EXIT 0.
- 2026-06-22: **Part C complete** (image preview cache). New `preview-cache.ts`:
  `getThumbnail` generates a WebP via `Bun.Image(src).resize(w).webp().bytes()`,
  cached under `FILE_PREVIEW_CACHE_DIR` keyed by sha256+width; `parseThumbnailWidth`
  whitelist (64/160/320/640/1280). `buildDownloadResponse` serves the cached
  thumbnail for inline image `?thumb=<w>` (same-origin, `immutable`, `ETag`); the
  file + drive content routes parse `?thumb`. Web drive grid uses `?thumb=320`;
  the preview dialog keeps the original. Config `FILE_PREVIEW_CACHE_ENABLED/DIR`.
  Tests: `preview-cache.test.ts` (4 pass, real JPEG→WebP + cache hit). `bun run
  check` EXIT 0. **FEAT-044 complete (A+B+C).** Not committed/pushed yet.
- 2026-06-22: **Part A complete** (S3 driver + presigned download). New
  `storage/s3.ts` (Bun native `S3Client`: put/getStream/delete/exists/
  presignDownload, key prefixing), self-registered via `index.ts`. Config
  `FILE_S3_*` (all optional; driver defaults region=`auto`, prefix=empty).
  `FileStorageDriver.put` gained optional `{ contentType }` so S3 objects store
  their MIME type; `uploadAndReference` passes `file.type`. `buildDownloadResponse`
  now presigns **only for inline-safe previews** (Bun presign can't sign
  Content-Disposition → attachment downloads stream through the API). Docs:
  `.env.example` + `docs/modules/file.md` S3 section (incl. R2 CORS note),
  regenerated env-reference. Tests: `storage/s3.test.ts` (7 pass — registration,
  setup validation, key prefixing, offline presign). `bun run check` EXIT 0. No
  new routes, no migration. Next: Part B (presigned direct upload).
