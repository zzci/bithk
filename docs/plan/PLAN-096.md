# PLAN-096 S3 storage driver + presigned direct upload + image preview cache

- **status**: completed
- **createdAt**: 2026-06-22 00:00
- **approvedAt**: 2026-06-22 00:00
- **relatedTask**: FEAT-044

## Context

The file module (`apps/api/src/modules/file/`) is content-addressable: the
`files` table is keyed `UNIQUE(sha256, storage_driver)`, `storageKey =
deriveStorageKey(sha256)` = `ab/cd/<sha256>` (`storage/key.ts`). `uploadAndReference()`
(`file.service.ts:130`) reads the bytes, hashes them, dedups, calls `driver.put`,
and inserts `files` + `file_references`. Downloads go through
`buildDownloadResponse()` (`file.service.ts:550`): when `FILE_PRESIGN_ENABLED`
and the driver implements `presignDownload`, it 302-redirects to a signed URL;
otherwise it streams via `driver.getStream`. `INLINE_ALLOWED` gates which types
render inline (images + pdf).

The `FileStorageDriver` interface (`storage/types.ts`) has `put/getStream/delete/
exists/presignDownload?` and a `setup(config)` hook; drivers self-register via
`registerDriver` and are selected by `FILE_STORAGE_DRIVER`. Only `local` ships.
There is **no** `presignUpload`. GC (`gc.ts`) deletes `files` rows with
`ref_count = 0`; the orphan sweep (`orphan-sweep.ts`) is DB-driven (parent-row
missing) and would not catch S3 objects uploaded but never confirmed.

Frontend: drive uploads go through an XHR multipart POST to
`/api/drive/files/upload` with `xhr.upload` progress (`shared/components/file/
upload-queue.ts`). Image previews fetch the content blob and `URL.createObjectURL`
it; attachment previews already use a raw `fetch()` anticipating a 302 to a
cross-origin presigned URL. No client preview cache exists.

Verified: Bun 1.3.14 ships native `Bun.S3Client` (`presign(key,{method,expiresIn,
type,acl})`, `file().stream()/exists()/stat()/write()/delete()`, `list()`) and
`Bun.Image` (`new Bun.Image(bytes).resize(w).webp()` → 108 KB JPEG to 9 KB WebP,
no deps). `presign` signs only method/expiresIn/type/acl — not checksum or
content-length — so direct-upload integrity relies on trusting the client hash
plus external size enforcement (per the locked decisions).

## Proposal

### Part A — S3 driver + presigned download

- **Config** (`config/schema.ts`, `config.ts`, `.env.example`): `FILE_S3_BUCKET`,
  `FILE_S3_REGION` (default `auto`), `FILE_S3_ENDPOINT`, `FILE_S3_ACCESS_KEY_ID`,
  `FILE_S3_SECRET_ACCESS_KEY`, `FILE_S3_FORCE_PATH_STYLE` (default `false`),
  `FILE_S3_PREFIX` (default `""`), `FILE_S3_ACL` (optional; omitted for R2).
- **`storage/s3.ts`**: build a `Bun.S3Client` in `setup(config)` (fail fast if
  `driver===s3` and bucket/credentials missing); `put/getStream/delete/exists`
  map to the client; `presignDownload(key,opts)` signs a GET with the content
  type + TTL (and, if Bun supports it, `response-content-disposition`). Apply the
  `FILE_S3_PREFIX` to every key. `registerDriver(s3Driver)` at module load;
  `index.ts` imports it so it self-registers; `setActiveDriver` already wires the
  selection.
- Uploads still flow through `driver.put`; `buildDownloadResponse` already calls
  `presignDownload` when enabled — no route change needed for A.
- Tests: a contract test for the driver behind a mock/local S3 (or unit-level
  with a stubbed client) covering key prefixing and presign.

### Part B — presigned direct upload

- Extend `FileStorageDriver` with optional `presignUpload(key,opts)` →
  `{ url, method, headers }`; S3 implements it (`presign(method:"PUT")`).
- **`POST /files/presign-upload`** (`{ sha256, size, mimetype, ownerType,
  ownerId, filename }`): authorize via the owner's permission hook; advisory
  reject if `size > MAX_UPLOAD_BYTES`; if `(sha256, driver)` exists →
  `addReference` and return `{ deduped: true, reference }` (instant, no upload);
  else return `{ uploadUrl, headers, key }`.
- **`POST /files/confirm-upload`** (`{ sha256, mimetype, ownerType, ownerId,
  filename }`): `driver.stat(key)` for existence + authoritative size; insert the
  `files` row (size from stat, `storageDriver=s3`) + `file_references`;
  `incrementUploadsUsed`. No re-hash.
- **Async S3 sweep** (extend `gc.ts`/a new sweep): `driver.list(prefix)` →
  anti-join `files.storageKey`; delete objects with no row older than a TTL, and
  objects whose size exceeds `MAX_UPLOAD_BYTES`. Guarded to the active s3 driver.
- **Frontend** (`upload-queue.ts`): for the s3 path, compute sha256 with
  `crypto.subtle.digest`, call presign-upload; on `deduped` finish immediately;
  else `xhr.PUT` the file to `uploadUrl` (progress via `xhr.upload`), then
  confirm-upload. Keep the through-API path for the local driver (feature-detect
  via a capability flag from the server, e.g. `/system/upload-limits` gains
  `directUpload: boolean`).

### Part C — image preview cache (Bun WebP thumbnails)

- **`file/preview-cache.ts`**: `getThumbnail(driver, file, width)` →
  cache path `${FILE_PREVIEW_CACHE_DIR}/${sha256}/w${width}.webp`; on miss,
  `driver.getStream`→bytes→`new Bun.Image(bytes).resize(width).webp()`→write
  cache→return. `getOriginalCached(driver, file)` read-through for full images.
  Simple size-bounded LRU eviction (`FILE_PREVIEW_CACHE_MAX_BYTES`).
- **`buildDownloadResponse`**: when the file is an image and inline:
  - `?thumb=<w>` (whitelist e.g. 64/160/320/640) → serve cached WebP, same-origin,
    `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`,
    `ETag: "<sha256>-w<width>"`.
  - full inline image → read-through original cache (or, if cache disabled,
    presign/stream as today).
  - non-image / attachment → unchanged (302 presign or stream).
- **Frontend**: grid/inline thumbnail URLs add `&thumb=<w>`
  (`shared/lib/file/index.ts:110`, `resource/attachment-section.tsx:90`); the
  full-screen preview dialog keeps the full URL.
- **Config**: `FILE_PREVIEW_CACHE_ENABLED` (default `true`), `FILE_PREVIEW_CACHE_DIR`
  (default under data dir), `FILE_PREVIEW_CACHE_MAX_BYTES`.

## Risks

- **Dedup poisoning** (trusting client hash): an authenticated user could store
  bytes under a hash that does not match. Accepted per the locked decision
  (internal authenticated tool); mitigated by the external sweep and the fact
  that only staff have accounts. Documented.
- **Bun presign limits**: no signed content-length/checksum, and possibly no
  `response-content-disposition`. Size is enforced via S3 config + sweep;
  attachment downloads may fall back to streaming-through-API if disposition
  can't be signed (verify during A).
- **S3 CORS**: image-preview `fetch().blob()` and direct PUT require the R2 bucket
  to allow the app origin (GET/PUT/HEAD, expose ETag). The preview cache serves
  images same-origin, sidestepping CORS for thumbnails. Deployment-documented.
- **Orphans**: a presigned PUT that never confirms leaves an S3 object; the async
  sweep reclaims it. Until the sweep runs it occupies space (bounded by TTL).
- **Cache growth**: thumbnail cache is bounded by `FILE_PREVIEW_CACHE_MAX_BYTES`
  with LRU eviction; content-addressed keys never invalidate.

## Scope

New: `storage/s3.ts`, `preview-cache.ts`. Touched: `storage/types.ts`,
`storage/index.ts`/registry wiring, `file.service.ts`, `file.routes.ts`,
`gc.ts`/sweep, `config/schema.ts`, `config.ts`, `system.routes.ts`
(directUpload flag), web `upload-queue.ts` + thumbnail URL sites, `.env.example`,
`docs/modules/file.md`, regenerated env/api docs, changelog. **No DB migration.**

## Alternatives

- **Server-side hash re-verify at confirm** — rejected by the user (trust client
  hash; size via S3 + external scan).
- **Cache original bytes only, no thumbnails** — superseded: Bun ships native
  image resize, so WebP thumbnails are cheap and save more bandwidth.
- **AWS-first config defaults** — superseded: default to Cloudflare R2.
- **Per-upload `presignUpload` with signed size/checksum** — not supported by
  Bun's simple presign; would require hand-rolled SigV4. Out of scope.

## Annotations

- 2026-06-22: Approved after iterating decisions: (1) trust client sha256 for
  dedup, no server re-hash; (1b) size via S3-side limits + async external scan;
  (2) native `Bun.Image` WebP thumbnail cache; (3) phased A→B→C; (4) default
  Cloudflare R2 (region `auto`, no ACL on presign, path-style off). "开工".
