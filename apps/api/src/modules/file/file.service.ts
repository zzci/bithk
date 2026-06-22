import type { PresignedUpload } from "./storage/types";
import type { Config } from "@/config";
import type { AppDatabase, AppTransaction } from "@/db";
import { createHash } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { fileReferences, files } from "@/modules/file/schema";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { AppError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";
import { mimeMatchesContent } from "@/shared/lib/mime-sniff";
import { assertWithinTotalQuota, decrementUploadsUsed, incrementUploadsUsed, isWithinFileSize, maxAttachmentsPerResource } from "@/shared/lib/upload-limits";
import { getThumbnail, previewCacheEnabled } from "./preview-cache";
import { deriveStorageKey } from "./storage/key";
import { getActiveDriver } from "./storage/registry";

export type FileRow = typeof files.$inferSelect;
export type FileReferenceRow = typeof fileReferences.$inferSelect;

// ─── Inline content URL ──────────────────────────────────────────────────
//
// URLs the server hands the frontend to render directly in an `<img>` (cover
// images, avatars) bypass the `http()` client, so nothing prepends the
// deployment base path for them. The API is mounted at `${BASE_PATH}/api`, so a
// bare `/api/...` resolves outside the base and 404s under a base-path deploy
// (e.g. `BASE_PATH=/app`). Like the local driver's `localRoot`, the base is a
// boot constant cached once at `initFileModule(config)`; code paths that never
// init the module see "" (root), which matches dev and keeps unit tests stable.
let urlBasePath = "";

/** Cache the deployment base path used by {@link fileInlineContentUrl}. Called from `initFileModule`. */
export function setFileUrlBasePath(basePath: string): void {
  urlBasePath = basePath;
}

/**
 * Build the inline-content URL the frontend renders directly in an `<img>`.
 * Carries the configured `BASE_PATH` so it resolves under base-path deploys
 * (`${BASE_PATH}/api/files/:id/content?ref=:ref&inline=true`).
 */
export function fileInlineContentUrl(fileId: string, referenceId: string): string {
  return `${urlBasePath}/api/files/${fileId}/content?ref=${referenceId}&inline=true`;
}

/**
 * Subset of `Config` the file service needs at runtime. Callers thread
 * this through from `c.get("config")` rather than the service caching a
 * process-global copy. Narrowed type so unrelated config drift cannot
 * silently change file-service behaviour.
 */
export interface FileServiceConfig {
  readonly FILE_GC_MODE: "async" | "sync";
  readonly FILE_PRESIGN_ENABLED: boolean;
  readonly FILE_PRESIGN_TTL_SECONDS: number;
  readonly FILE_PREVIEW_CACHE_ENABLED?: "true" | "false" | undefined;
  readonly FILE_PREVIEW_CACHE_DIR?: string | undefined;
}

/**
 * Accepted-type policy, passed in per call. BITHK is an OA system: a generic
 * file surface must never refuse an upload, so {@link ACCEPT_ANY} is the
 * default and type-blocking is deferred to the serve layer (see
 * {@link buildDownloadResponse}). This is the SINGLE canonical, fully
 * parameter-driven type filter — every surface passes its own policy and the
 * file module is the one place that evaluates it (via {@link policyAllows}), so
 * routes never carry per-type logic.
 *
 * Three forms:
 * - `"any"` — never blocks (the OA default).
 * - `{ allow }` — an allow-list of mime patterns (exact string or RegExp).
 * - `(mime) => boolean` — an arbitrary predicate.
 *
 * Under ANY restrictive form (allow-list or predicate) the magic-byte
 * integrity check also runs; under `"any"` it does not.
 */
export type FileTypePolicy
  = | "any"
    | { readonly allow: readonly (string | RegExp)[] }
    | ((mime: string) => boolean);

/** Accept every mime type — the default for generic OA file surfaces. */
export const ACCEPT_ANY: FileTypePolicy = "any";

/** Restrict to image mime types — avatars and cover images. */
export const ACCEPT_IMAGES: FileTypePolicy = { allow: [/^image\//] };

export function policyAllows(policy: FileTypePolicy, mime: string): boolean {
  if (policy === "any")
    return true;
  if (typeof policy === "function")
    return policy(mime);
  return policy.allow.some(p => (typeof p === "string" ? p === mime : p.test(mime)));
}

export interface UploadInput {
  readonly file: File;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly uploadedBy: string;
  readonly metadata?: Record<string, unknown> | undefined;
  /**
   * Accepted-type policy for this upload. Defaults to {@link ACCEPT_ANY} —
   * generic OA surfaces accept any file. Image-only surfaces pass
   * {@link ACCEPT_IMAGES}. Under a restrictive policy the declared mime must
   * match the allow-list AND the sniffed magic bytes; under `"any"` no type
   * gate runs at all. The size ceiling and per-resource/quota limits always
   * apply regardless of policy. Downloads are served as attachments for every
   * non-inline-safe type, so an arbitrary upload can never execute inline.
   */
  readonly accept?: FileTypePolicy | undefined;
  /**
   * Permit a zero-byte file. Server-generated text files (the drive "new
   * document" flow) are created empty and filled in via the editor
   * afterwards. The per-file ceiling still applies.
   */
  readonly allowEmpty?: boolean | undefined;
}

export interface UploadResult {
  readonly file: FileRow;
  readonly reference: FileReferenceRow;
  /** True iff the upload hit an existing `files` row (dedupe). */
  readonly deduped: boolean;
}

/**
 * Upload bytes and register a reference. The same content uploaded twice
 * yields **one** `files` row and **two** `file_references` rows. The
 * per-reference uniqueness rule prevents the same owner from holding two
 * references to the same blob.
 *
 * Permission is **not** checked here — sub-types resolve "can this actor
 * upload to this owner?" at the route boundary before calling this.
 */
export async function uploadAndReference(
  db: AppDatabase,
  config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES">,
  input: UploadInput,
): Promise<UploadResult> {
  const { file, ownerType, ownerId, uploadedBy } = input;
  const policy = input.accept ?? ACCEPT_ANY;

  if (!isWithinFileSize(file.size, config) && !(input.allowEmpty && file.size === 0)) {
    throw new AppError("File size exceeds per-file limit", 400, "FILE_TOO_LARGE");
  }
  if (policy !== "any" && !policyAllows(policy, file.type)) {
    throw new AppError("File type not allowed", 400, "INVALID_MIMETYPE");
  }

  // Read the buffer once. Bun gives us an ArrayBuffer; we sniff the first
  // 1 KiB for magic-byte verification, hash the full bytes for the content
  // key, and hand the same buffer to the storage driver. Streaming
  // upload+hash is a follow-up; the current 10 MiB per-file cap keeps the
  // memory profile fine.
  const buffer = await file.arrayBuffer();

  // Magic-byte integrity check applies ONLY under a restrictive policy: a
  // generic OA surface (`"any"`) must accept arbitrary bytes, whereas an
  // image-only surface must reject a file that *declares* an image type but
  // whose content is not one.
  const sniffWindow = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  if (policy !== "any" && !mimeMatchesContent(file.type, sniffWindow)) {
    throw new AppError("File contents do not match declared type", 400, "MIME_MISMATCH");
  }

  const sha256 = sha256Hex(buffer);
  const driver = getActiveDriver();

  // Enforce per-resource attachment count BEFORE consuming quota. The
  // count is whatever the consumer modelled as "attachments on this
  // owner" — which by convention is "references with this owner_type +
  // owner_id" so the same rule applies to every consumer.
  const existing = await db.select({ value: count() })
    .from(fileReferences)
    .where(and(
      eq(fileReferences.ownerType, ownerType),
      eq(fileReferences.ownerId, ownerId),
    ))
    .get();
  const maxAttachments = maxAttachmentsPerResource(config);
  if ((existing?.value ?? 0) >= maxAttachments) {
    throw new AppError(
      `Maximum attachments per resource reached (${maxAttachments})`,
      400,
      "LIMIT_EXCEEDED",
    );
  }

  // Reject before consuming bytes — keeps the request from spending IO on a
  // file that the per-tenant quota will refuse.
  await assertWithinTotalQuota(db, config, file.size);

  // Phase 1 — dedupe inside a sync tx: if the blob is already on this driver,
  // just bump the refcount and attach a reference. No driver I/O needed.
  // bun:sqlite transactions are synchronous; driver.put cannot run inside.
  const dedupe = db.transaction((tx) => {
    const existing = tx.select().from(files).where(
      and(eq(files.sha256, sha256), eq(files.storageDriver, driver.name)),
    ).get();
    if (!existing)
      return null;

    tx.update(files)
      .set({ refCount: sql`${files.refCount} + 1` })
      .where(eq(files.id, existing.id))
      .run();

    const refId = nanoid();
    try {
      tx.insert(fileReferences).values({
        id: refId,
        fileId: existing.id,
        ownerType,
        ownerId,
        filename: file.name,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdBy: uploadedBy,
      }).run();
    }
    catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError("This file is already attached to this resource", 400, "DUPLICATE_REFERENCE");
      }
      throw err;
    }
    const ref = tx.select().from(fileReferences).where(eq(fileReferences.id, refId)).get()!;
    return { file: { ...existing, refCount: existing.refCount + 1 }, reference: ref, deduped: true };
  });

  if (dedupe)
    return dedupe;

  // Phase 2 — write the blob outside the tx. A failure in the subsequent
  // insert leaves an orphan blob, which the periodic file GC reclaims.
  const newId = ulid();
  const storageKey = deriveStorageKey(sha256);
  // Pass the MIME type so object-store drivers (S3) persist it and a later
  // presigned GET serves the right Content-Type for inline preview.
  await driver.put(storageKey, buffer, { contentType: file.type });

  // Phase 3 — insert the files row + reference in a sync tx. A concurrent
  // uploader may have raced ahead via the dedupe path; re-check and bump
  // refcount instead of inserting in that case.
  const result = db.transaction((tx) => {
    let row = tx.select().from(files).where(
      and(eq(files.sha256, sha256), eq(files.storageDriver, driver.name)),
    ).get();
    let insertedNewBlob = false;

    if (row) {
      // Lost the race — bump refcount and let the orphan blob be reclaimed.
      tx.update(files)
        .set({ refCount: sql`${files.refCount} + 1` })
        .where(eq(files.id, row.id))
        .run();
      row = { ...row, refCount: row.refCount + 1 };
    }
    else {
      tx.insert(files).values({
        id: newId,
        sha256,
        size: file.size,
        mimetype: file.type,
        storageDriver: driver.name,
        storageKey,
        refCount: 1,
        uploadedBy,
      }).run();
      row = tx.select().from(files).where(eq(files.id, newId)).get()!;
      insertedNewBlob = true;
    }

    const refId = nanoid();
    try {
      tx.insert(fileReferences).values({
        id: refId,
        fileId: row.id,
        ownerType,
        ownerId,
        filename: file.name,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdBy: uploadedBy,
      }).run();
    }
    catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError("This file is already attached to this resource", 400, "DUPLICATE_REFERENCE");
      }
      throw err;
    }
    const ref = tx.select().from(fileReferences).where(eq(fileReferences.id, refId)).get()!;
    return { file: row, reference: ref, deduped: false, insertedNewBlob };
  });

  // A genuinely new blob adds `file.size` to the tracked total. Keep the
  // cached quota usage in step so `assertWithinTotalQuota` stays accurate
  // between the periodic SQL recomputes (dedupe / lost-race add no bytes).
  if (result.insertedNewBlob)
    incrementUploadsUsed(file.size);
  return { file: result.file, reference: result.reference, deduped: result.deduped };
}

export interface AddReferenceInput {
  readonly fileId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly filename?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdBy: string;
}

/**
 * Register an additional reference to an already-stored file (no upload).
 * Used by features that "copy" an attachment between resources without
 * re-uploading the blob — e.g. duplicating an item.
 */
export async function addReference(db: AppDatabase, input: AddReferenceInput): Promise<FileReferenceRow> {
  return db.transaction((tx) => {
    const file = tx.select().from(files).where(eq(files.id, input.fileId)).get();
    if (!file) {
      throw new AppError("File not found", 404, "NOT_FOUND");
    }

    tx.update(files)
      .set({ refCount: sql`${files.refCount} + 1` })
      .where(eq(files.id, input.fileId))
      .run();

    const refId = nanoid();
    try {
      tx.insert(fileReferences).values({
        id: refId,
        fileId: input.fileId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        filename: input.filename ?? file.id,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdBy: input.createdBy,
      }).run();
    }
    catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError("This file is already attached to this resource", 400, "DUPLICATE_REFERENCE");
      }
      throw err;
    }
    return tx.select().from(fileReferences).where(eq(fileReferences.id, refId)).get()!;
  });
}

// ─── Presigned direct upload (FEAT-044, Part B) ───────────────────────────
//
// The bytes go straight to the storage backend (S3) via a presigned PUT, so
// the API never sees them. Integrity uses the CLIENT-supplied sha256 as the
// content-addressed key (a deliberate trust decision for an internal tool);
// size is enforced by the S3 backend + an external sweep, with only a cheap
// advisory check here. `confirm` reads the authoritative size via `stat`.

/** True when the active driver can issue presigned PUTs and HEAD objects. */
export function directUploadAvailable(): boolean {
  let driver;
  try {
    driver = getActiveDriver();
  }
  catch {
    // No driver selected yet (boot order / unit tests without initFileModule).
    return false;
  }
  return typeof driver.presignUpload === "function" && typeof driver.stat === "function";
}

/** Look up the existing blob row for `(sha256, active driver)`, if any. */
export async function findStoredBlob(db: AppDatabase, sha256: string): Promise<FileRow | undefined> {
  const driver = getActiveDriver();
  return db.select().from(files).where(and(eq(files.sha256, sha256), eq(files.storageDriver, driver.name))).get();
}

/** Issue a presigned PUT for the content-addressed key of `sha256`. Returns null when the driver can't. */
export async function presignBlobUpload(
  config: Pick<Config, "FILE_PRESIGN_TTL_SECONDS">,
  sha256: string,
  mimetype: string,
): Promise<PresignedUpload | null> {
  const driver = getActiveDriver();
  if (!driver.presignUpload)
    return null;
  return driver.presignUpload(deriveStorageKey(sha256), {
    expiresSeconds: config.FILE_PRESIGN_TTL_SECONDS,
    contentType: mimetype,
  });
}

/** HEAD the directly-uploaded object to confirm it landed and read its size. */
export async function statStoredBlob(sha256: string): Promise<{ readonly size: number } | null> {
  const driver = getActiveDriver();
  if (!driver.stat)
    return null;
  return driver.stat(deriveStorageKey(sha256));
}

export interface RegisterUploadedBlobInput {
  readonly sha256: string;
  readonly size: number;
  readonly mimetype: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly uploadedBy: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Register a `files` row + `file_references` row for a blob that is ALREADY in
 * the active storage backend (uploaded directly via a presigned PUT). Dedups on
 * `(sha256, driver)` exactly like {@link uploadAndReference}, but performs no
 * `driver.put` — the bytes are already there. Quota/size were checked at the
 * presign step; this only bumps the running total for a genuinely new blob.
 */
export async function registerUploadedBlob(db: AppDatabase, input: RegisterUploadedBlobInput): Promise<UploadResult> {
  const driver = getActiveDriver();
  const storageKey = deriveStorageKey(input.sha256);
  const newId = ulid();

  const result = db.transaction((tx) => {
    let row = tx.select().from(files).where(
      and(eq(files.sha256, input.sha256), eq(files.storageDriver, driver.name)),
    ).get();
    let insertedNewBlob = false;

    if (row) {
      tx.update(files).set({ refCount: sql`${files.refCount} + 1` }).where(eq(files.id, row.id)).run();
      row = { ...row, refCount: row.refCount + 1 };
    }
    else {
      tx.insert(files).values({
        id: newId,
        sha256: input.sha256,
        size: input.size,
        mimetype: input.mimetype,
        storageDriver: driver.name,
        storageKey,
        refCount: 1,
        uploadedBy: input.uploadedBy,
      }).run();
      row = tx.select().from(files).where(eq(files.id, newId)).get()!;
      insertedNewBlob = true;
    }

    const refId = nanoid();
    try {
      tx.insert(fileReferences).values({
        id: refId,
        fileId: row.id,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        filename: input.filename,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdBy: input.uploadedBy,
      }).run();
    }
    catch (err) {
      if (isUniqueConstraintError(err))
        throw new AppError("This file is already attached to this resource", 400, "DUPLICATE_REFERENCE");
      throw err;
    }
    const reference = tx.select().from(fileReferences).where(eq(fileReferences.id, refId)).get()!;
    return { file: row, reference, insertedNewBlob };
  });

  if (result.insertedNewBlob)
    incrementUploadsUsed(input.size);

  return { file: result.file, reference: result.reference, deduped: !result.insertedNewBlob };
}

export interface ReleaseReferenceInput {
  readonly referenceId: string;
}

/**
 * A blob whose refcount dropped to zero when its last reference was
 * released. Returned by {@link releaseReferenceTx} so the caller can drive
 * the post-commit side effect ({@link finalizeReleasedBlob}) — driver I/O
 * (sync-GC blob delete) cannot run inside a synchronous bun:sqlite tx.
 */
export interface DrainedBlob {
  readonly id: string;
  readonly storageDriver: string;
  readonly storageKey: string;
  readonly size: number;
}

/**
 * DB-only reference release that runs inside a **caller-provided**
 * transaction: deletes the `file_references` row and decrements the blob
 * `ref_count`. Returns the {@link DrainedBlob} when the refcount hit zero so
 * the caller can finalise the blob after the tx commits, or `null` when the
 * reference is missing (idempotent) or the blob still has live references.
 *
 * Use this when the release must be atomic with other writes in the same
 * transaction (e.g. repointing a project cover then releasing the old
 * reference). For a standalone release, call {@link releaseReference}.
 */
export function releaseReferenceTx(tx: AppTransaction, referenceId: string): DrainedBlob | null {
  const ref = tx.select().from(fileReferences).where(eq(fileReferences.id, referenceId)).get();
  if (!ref)
    return null;

  tx.delete(fileReferences).where(eq(fileReferences.id, referenceId)).run();
  tx.update(files)
    .set({ refCount: sql`MAX(${files.refCount} - 1, 0)` })
    .where(eq(files.id, ref.fileId))
    .run();
  const after = tx.select({ refCount: files.refCount, storageDriver: files.storageDriver, storageKey: files.storageKey, size: files.size })
    .from(files)
    .where(eq(files.id, ref.fileId))
    .get();
  return after && after.refCount === 0 ? { id: ref.fileId, ...after } : null;
}

/**
 * Drive the post-commit side effect for a blob drained inside a transaction
 * via {@link releaseReferenceTx}: in sync-GC mode delete the blob bytes +
 * `files` row immediately; in async mode the sweeper reclaims refcount=0
 * rows, so this is a no-op. Safe to call with `null` (nothing drained).
 */
export async function finalizeReleasedBlob(
  db: AppDatabase,
  config: FileServiceConfig,
  drained: DrainedBlob | null,
): Promise<void> {
  if (drained && config.FILE_GC_MODE === "sync") {
    await syncDeleteBlob(db, drained);
  }
}

/**
 * Drop one reference. In async-GC mode, only the `file_references` row is
 * deleted and `files.ref_count` decremented; the sweeper handles the blob.
 * In sync-GC mode (tests / local-only), if the final reference goes away
 * we also drive `driver.delete` + the `files` row delete immediately.
 *
 * No-op if the reference is missing — release is idempotent so a retried
 * client request can't 404.
 */
export async function releaseReference(
  db: AppDatabase,
  config: FileServiceConfig,
  input: ReleaseReferenceInput,
): Promise<void> {
  const drained = db.transaction(tx => releaseReferenceTx(tx, input.referenceId));
  await finalizeReleasedBlob(db, config, drained);
}

/**
 * Drop every reference belonging to a single owner. Used when the parent
 * resource is hard-deleted (e.g. eventual item-retention janitor). Each
 * blob whose refcount hits zero is queued for the sweeper (async) or
 * deleted immediately (sync).
 */
export async function releaseAllByOwner(
  db: AppDatabase,
  config: FileServiceConfig,
  ownerType: string,
  ownerId: string,
): Promise<void> {
  const refs = await db.select({ id: fileReferences.id })
    .from(fileReferences)
    .where(and(eq(fileReferences.ownerType, ownerType), eq(fileReferences.ownerId, ownerId)))
    .all();
  for (const r of refs) {
    await releaseReference(db, config, { referenceId: r.id });
  }
}

async function syncDeleteBlob(
  db: AppDatabase,
  drained: DrainedBlob,
): Promise<void> {
  const driver = getActiveDriver();
  if (driver.name !== drained.storageDriver) {
    // Stored under a different driver than the active one — we can't
    // safely delete it. Leave for an operator / future cross-driver
    // sweep. The async path handles this case too.
    return;
  }
  try {
    await driver.delete(drained.storageKey);
  }
  catch {
    // Tolerated: the row stays at refcount=0 and the next sweep retries.
    return;
  }
  await db.delete(files).where(eq(files.id, drained.id)).run();
  // Blob bytes are gone — release them from the tracked quota usage.
  decrementUploadsUsed(drained.size);
}

// ─── Read-side helpers ──────────────────────────────────────────────────

export async function getFileById(db: AppDatabase, id: string): Promise<FileRow | undefined> {
  return await db.select().from(files).where(eq(files.id, id)).get();
}

export async function getReferenceById(db: AppDatabase, id: string): Promise<FileReferenceRow | undefined> {
  return await db.select().from(fileReferences).where(eq(fileReferences.id, id)).get();
}

/**
 * Reference row enriched with the underlying blob's `mimetype` and `size`.
 * The wire shape that issue / document attachment endpoints return — gives
 * consumers everything they need to render a file row (icon, size) without
 * a second round-trip to `files`.
 */
export interface AttachmentView {
  readonly id: string;
  readonly fileId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

function composeAttachmentView(ref: FileReferenceRow, file: { mimetype: string; size: number }): AttachmentView {
  return {
    id: ref.id,
    fileId: ref.fileId,
    ownerType: ref.ownerType,
    ownerId: ref.ownerId,
    filename: ref.filename,
    mimetype: file.mimetype,
    size: file.size,
    createdBy: ref.createdBy,
    createdAt: ref.createdAt,
  };
}

export async function listAttachmentsByOwner(
  db: AppDatabase,
  ownerType: string,
  ownerId: string,
): Promise<readonly AttachmentView[]> {
  const rows = await db
    .select({
      ref: fileReferences,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(fileReferences)
    .innerJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(eq(fileReferences.ownerType, ownerType), eq(fileReferences.ownerId, ownerId)))
    .orderBy(desc(fileReferences.createdAt), desc(fileReferences.id))
    .all();
  return rows.map(r => composeAttachmentView(r.ref, { mimetype: r.mimetype, size: r.size }));
}

/** Compose a single attachment view from rows the caller already holds. */
export function makeAttachmentView(ref: FileReferenceRow, file: FileRow): AttachmentView {
  return composeAttachmentView(ref, { mimetype: file.mimetype, size: file.size });
}

// ─── Download ─────────────────────────────────────────────────────────

interface DownloadResponseOpts {
  readonly inline: boolean;
  /** Whitelisted thumbnail width (px) for an inline image preview (FEAT-044). */
  readonly thumbWidth?: number | undefined;
}

/**
 * Build the HTTP response for a download. When the active driver supports
 * `presignDownload` and presigning is enabled, returns a 302 to a
 * short-lived signed URL — the API process never touches the bytes.
 * Otherwise streams the body through the driver.
 *
 * The MIME-safety logic mirrors what the existing attachment routes do:
 * `inline` is honoured only for known-safe types (images excl. SVG, text
 * excl. HTML, PDF / JSON / XML). Everything else is forced to
 * `application/octet-stream` so the browser doesn't auto-execute.
 */
export async function buildDownloadResponse(
  config: FileServiceConfig,
  file: FileRow,
  ref: FileReferenceRow,
  opts: DownloadResponseOpts,
): Promise<Response> {
  const mt = file.mimetype;
  // Inline rendering is opt-in only for media types that browsers
  // cannot execute even when sniffing fails or the sniff prefix (first
  // 1 KiB) was matched by an attacker-crafted polyglot. SVG, every
  // `text/*` (including text/xml: stylesheet vectors), JSON and the
  // generic application/xml are deliberately excluded — they download.
  // Active-content vectors stay blocked even if a future driver returns
  // a permissive Content-Type.
  const INLINE_ALLOWED = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "application/pdf",
  ]);
  const inlineSafe = opts.inline && INLINE_ALLOWED.has(mt);
  const contentType = inlineSafe ? mt : "application/octet-stream";
  const disposition = buildContentDisposition(inlineSafe ? "inline" : "attachment", ref.filename);

  const driver = getActiveDriver();

  // Image preview cache (FEAT-044, Part C): for an inline image request that
  // asks for a whitelisted width, serve a cached WebP thumbnail — same-origin
  // and immutable, so the grid never refetches full-resolution images and a
  // remote backend is hit at most once per (image, width). Falls through on a
  // decode failure (corrupt/unsupported image).
  if (
    inlineSafe
    && opts.thumbWidth !== undefined
    && mt.startsWith("image/")
    && driver.name === file.storageDriver
    && previewCacheEnabled(config)
  ) {
    const thumb = await getThumbnail(config, { sha256: file.sha256, storageKey: file.storageKey }, opts.thumbWidth);
    if (thumb) {
      return new Response(new Blob([thumb]), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Disposition": buildContentDisposition("inline", ref.filename),
          "Content-Length": String(thumb.byteLength),
          "Cache-Control": "private, max-age=31536000, immutable",
          "ETag": `"${file.sha256}-w${opts.thumbWidth}"`,
          "X-Content-Type-Options": "nosniff",
          "X-Download-Options": "noopen",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
  }

  // Only presign for INLINE-safe previews. A presigned GET serves the object
  // with its stored Content-Type but cannot force `Content-Disposition`
  // (Bun's presign signs only method/expiry/type), so attachment downloads
  // must stream through the API to carry `attachment; filename=…`.
  if (inlineSafe && config.FILE_PRESIGN_ENABLED && driver.name === file.storageDriver && driver.presignDownload) {
    const url = await driver.presignDownload(file.storageKey, {
      expiresSeconds: config.FILE_PRESIGN_TTL_SECONDS,
      filename: ref.filename,
      inline: inlineSafe,
      contentType,
    });
    return new Response(null, { status: 302, headers: { Location: url } });
  }

  if (driver.name !== file.storageDriver) {
    // Stored under a driver no longer active — surface as 404 rather
    // than serving bytes that may not even exist on this filesystem.
    throw new AppError("File backend mismatch", 404, "FILE_BACKEND_MISMATCH");
  }

  const stream = await driver.getStream(file.storageKey);
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(file.size),
      "X-Content-Type-Options": "nosniff",
      "X-Download-Options": "noopen",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

// ─── GC support (used by the sweeper) ─────────────────────────────────

export async function listUnreferencedFiles(db: AppDatabase, limit: number): Promise<readonly FileRow[]> {
  return await db.select().from(files).where(eq(files.refCount, 0)).limit(limit).all();
}

export async function deleteUnreferencedFile(db: AppDatabase, file: FileRow): Promise<boolean> {
  const driver = getActiveDriver();
  if (driver.name !== file.storageDriver) {
    return false;
  }
  try {
    await driver.delete(file.storageKey);
  }
  catch {
    return false;
  }
  await db.delete(files).where(and(eq(files.id, file.id), eq(files.refCount, 0))).run();
  // Reclaimed bytes leave the tracked quota usage.
  decrementUploadsUsed(file.size);
  return true;
}

// ─── helpers ──────────────────────────────────────────────────────────

function sha256Hex(buffer: ArrayBuffer): string {
  const hash = createHash("sha256");
  hash.update(new Uint8Array(buffer));
  return hash.digest("hex");
}

/**
 * Drizzle wraps the underlying libsql error and prepends "Failed query: …".
 * The "UNIQUE constraint failed: …" string lives on `err.cause`; walk both
 * the top-level message and the cause chain to identify it.
 */
function isUniqueConstraintError(err: unknown): boolean {
  let cur: unknown = err;
  while (cur instanceof Error) {
    if (/UNIQUE constraint failed/i.test(cur.message))
      return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
