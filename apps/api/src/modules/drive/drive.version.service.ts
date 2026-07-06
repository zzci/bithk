import type { DriveEntryRow } from "./drive.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { isQuarantinedFile, releaseReference, uploadAndReference } from "@/modules/file";
import { fileReferences, files } from "@/modules/file/schema";
import { AppError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { driveEntries, driveFileVersions } from "./schema";

export interface DriveVersionView {
  readonly id: string;
  /** Ascending display label (oldest = 1 … newest = N); not stored. */
  readonly versionNo: number;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
  /** True when this version's reference is the entry's display pointer. */
  readonly isCurrent: boolean;
}

type UploadConfig = Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">;

function assertFileEntry(entry: DriveEntryRow): void {
  if (entry.entryType !== "file" || !entry.fileReferenceId)
    throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY_TYPE");
}

/**
 * The entry's CURRENT file's storage driver and mimetype. A new version
 * inherits both: the driver (FEAT-047) so versions of a db-backed file stay in
 * the DB, and the mimetype (FIX-063) as `declaredMime` — a version of a sheet
 * is a sheet, and multipart transport loses the part's `Content-Type` (Bun
 * drops it server-side), so the entry's stored type is the authority.
 * `driverName` is `undefined` when the reference / file cannot be resolved or
 * the file is quarantined (FIX-062), letting the upload fall back to the
 * default driver; the mimetype is still inherited from a quarantined row.
 */
async function currentEntryFile(
  db: AppDatabase,
  entry: DriveEntryRow,
): Promise<{ driverName: string | undefined; mimetype: string | undefined }> {
  if (!entry.fileReferenceId)
    return { driverName: undefined, mimetype: undefined };
  const row = await db
    .select({ storageDriver: files.storageDriver, mimetype: files.mimetype })
    .from(fileReferences)
    .innerJoin(files, eq(fileReferences.fileId, files.id))
    .where(eq(fileReferences.id, entry.fileReferenceId))
    .get();
  if (!row)
    return { driverName: undefined, mimetype: undefined };
  return {
    driverName: isQuarantinedFile(row) ? undefined : row.storageDriver,
    mimetype: row.mimetype || undefined,
  };
}

/**
 * Versions for a file entry, newest first (ULID id desc), each flagged with
 * `isCurrent`. `versionNo` is a computed ascending display label (oldest = 1),
 * derived from position — it is not stored.
 */
export async function listEntryVersions(db: AppDatabase, entry: DriveEntryRow): Promise<readonly DriveVersionView[]> {
  assertFileEntry(entry);
  const rows = await db
    .select({
      version: driveFileVersions,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveFileVersions)
    .innerJoin(fileReferences, eq(driveFileVersions.fileReferenceId, fileReferences.id))
    .innerJoin(files, eq(fileReferences.fileId, files.id))
    .where(eq(driveFileVersions.driveEntryId, entry.id))
    .orderBy(desc(driveFileVersions.id))
    .all();

  // Rows are newest-first; the display label counts up from the oldest, so the
  // oldest (last row) is 1 and the newest (first row) is N.
  const total = rows.length;
  return rows.map((row, index) => ({
    id: row.version.id,
    versionNo: total - index,
    filename: row.filename,
    mimetype: row.mimetype,
    size: row.size,
    uploadedBy: row.version.uploadedBy,
    createdAt: row.version.createdAt,
    isCurrent: row.version.fileReferenceId === entry.fileReferenceId,
  }));
}

export interface UploadEntryVersionInput {
  readonly entry: DriveEntryRow;
  readonly file: File;
  readonly uploadedBy: string;
}

/**
 * Upload a new immutable version of an existing file entry: stores a fresh blob
 * reference and appends a `drive_file_versions` row (ULID id, time-sortable).
 * When the entry is NOT pinned (`displayVersionId == null`) the entry's display
 * pointer (`fileReferenceId`) advances to the new version; a pinned entry keeps
 * its pointer. The previous version's reference is kept (released only on
 * permanent delete). On any failure the just-uploaded reference is released so
 * no orphan accrues.
 */
export async function uploadEntryVersion(
  db: AppDatabase,
  config: UploadConfig,
  input: UploadEntryVersionInput,
): Promise<readonly DriveVersionView[]> {
  assertFileEntry(input.entry);
  const current = await currentEntryFile(db, input.entry);
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: input.entry.id,
    uploadedBy: input.uploadedBy,
    driverName: current.driverName,
    // Versions inherit the entry's mimetype (FIX-063): multipart transport
    // drops `File.type`, and a version of a sheet is a sheet.
    declaredMime: current.mimetype,
    // Content identical to an existing version blob of this entry (e.g.
    // "save as version" of unchanged content) reuses that version's
    // reference instead of failing DUPLICATE_REFERENCE (FIX-063).
    reuseExistingReference: true,
  });

  const pinned = input.entry.displayVersionId != null;
  try {
    db.transaction((tx) => {
      tx.insert(driveFileVersions).values({
        id: ulid(),
        driveEntryId: input.entry.id,
        fileReferenceId: uploaded.reference.id,
        uploadedBy: input.uploadedBy,
      }).run();
      tx.update(driveEntries)
        .set({
          updatedAt: new Date().toISOString(),
          // Unpinned entries follow the latest version; pinned entries stay put.
          ...(pinned ? {} : { fileReferenceId: uploaded.reference.id }),
        })
        .where(eq(driveEntries.id, input.entry.id))
        .run();
    });
  }
  catch (err) {
    // A REUSED reference belongs to another version row — releasing it here
    // would strand that row on a dangling id.
    if (!uploaded.reusedReference)
      await releaseReference(db, config, { referenceId: uploaded.reference.id });
    throw err;
  }

  const refreshed = await requireEntryRow(db, input.entry.id);
  return listEntryVersions(db, refreshed);
}

export interface OverwriteEntryVersionInput {
  readonly entry: DriveEntryRow;
  readonly versionId: string;
  readonly file: File;
  readonly uploadedBy: string;
}

/**
 * Overwrite an existing version's content in place — the session-coalesced
 * autosave. Within one editing session the periodic idle saves update the SAME
 * version instead of appending new rows, so a session yields a single version
 * (drastically fewer versions than one-per-autosave). Uploads a fresh blob,
 * repoints the version row at it, advances the entry's display pointer only when
 * the entry was displaying exactly this version's (now-previous) blob, then
 * releases the previous blob reference. 404 when the version is not the entry's.
 */
export async function overwriteEntryVersion(
  db: AppDatabase,
  config: UploadConfig,
  input: OverwriteEntryVersionInput,
): Promise<readonly DriveVersionView[]> {
  assertFileEntry(input.entry);
  const version = await db
    .select()
    .from(driveFileVersions)
    .where(and(eq(driveFileVersions.id, input.versionId), eq(driveFileVersions.driveEntryId, input.entry.id)))
    .get();
  if (!version)
    throw new AppError("Version not found", 404, "NOT_FOUND");

  const previousRefId = version.fileReferenceId;
  const current = await currentEntryFile(db, input.entry);
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: input.entry.id,
    uploadedBy: input.uploadedBy,
    driverName: current.driverName,
    // Versions inherit the entry's mimetype (FIX-063): multipart transport
    // drops `File.type`, and a version of a sheet is a sheet.
    declaredMime: current.mimetype,
    // Autosave content that dedups to one of this entry's own version blobs
    // (user undid back to a previously saved state) must succeed, not fail
    // DUPLICATE_REFERENCE (FIX-063): reuse the existing reference row.
    reuseExistingReference: true,
  });

  // Saved content identical to what this version already stores — a pure
  // no-op: nothing to repoint, nothing to release.
  if (uploaded.reference.id === previousRefId) {
    const refreshed = await requireEntryRow(db, input.entry.id);
    return listEntryVersions(db, refreshed);
  }

  // Advance the entry's display pointer only when it was showing exactly this
  // version's blob (unpinned-and-latest, or pinned to it) — never yank the
  // display off a different/newer version another session may have produced.
  const follows = input.entry.fileReferenceId === previousRefId;
  try {
    db.transaction((tx) => {
      tx.update(driveFileVersions)
        .set({ fileReferenceId: uploaded.reference.id })
        .where(eq(driveFileVersions.id, input.versionId))
        .run();
      tx.update(driveEntries)
        .set({
          updatedAt: new Date().toISOString(),
          ...(follows ? { fileReferenceId: uploaded.reference.id } : {}),
        })
        .where(eq(driveEntries.id, input.entry.id))
        .run();
    });
  }
  catch (err) {
    // A REUSED reference belongs to another version row — releasing it here
    // would strand that row on a dangling id.
    if (!uploaded.reusedReference)
      await releaseReference(db, config, { referenceId: uploaded.reference.id });
    throw err;
  }

  // Release the overwritten blob so the coalesced draft's prior bytes do not
  // accrue as orphans — but ONLY when no other version row of this entry still
  // references it. References can be shared between version rows once a
  // same-content save reused one (FIX-063); releasing a shared reference would
  // dangle the sibling version.
  const stillUsed = await db
    .select({ id: driveFileVersions.id })
    .from(driveFileVersions)
    .where(and(
      eq(driveFileVersions.driveEntryId, input.entry.id),
      eq(driveFileVersions.fileReferenceId, previousRefId),
    ))
    .get();
  if (!stillUsed)
    await releaseReference(db, config, { referenceId: previousRefId });

  const refreshed = await requireEntryRow(db, input.entry.id);
  return listEntryVersions(db, refreshed);
}

/**
 * Pin the entry's display to a specific version: sets `displayVersionId` and
 * points `fileReferenceId` at that version's blob so open / preview / download /
 * share all serve it. 404 when the version does not belong to the entry.
 */
export async function setDisplayVersion(
  db: AppDatabase,
  entry: DriveEntryRow,
  versionId: string,
): Promise<readonly DriveVersionView[]> {
  assertFileEntry(entry);
  const version = await db
    .select()
    .from(driveFileVersions)
    .where(and(eq(driveFileVersions.id, versionId), eq(driveFileVersions.driveEntryId, entry.id)))
    .get();
  if (!version)
    throw new AppError("Version not found", 404, "NOT_FOUND");

  await db.update(driveEntries)
    .set({ displayVersionId: versionId, fileReferenceId: version.fileReferenceId, updatedAt: new Date().toISOString() })
    .where(eq(driveEntries.id, entry.id))
    .run();

  const refreshed = await requireEntryRow(db, entry.id);
  return listEntryVersions(db, refreshed);
}

/**
 * Clear the pinned display: `displayVersionId = null` and `fileReferenceId` back
 * to the latest version (max ULID id) so the entry auto-follows newest again.
 */
export async function clearDisplayVersion(
  db: AppDatabase,
  entry: DriveEntryRow,
): Promise<readonly DriveVersionView[]> {
  assertFileEntry(entry);
  const latest = await db
    .select()
    .from(driveFileVersions)
    .where(eq(driveFileVersions.driveEntryId, entry.id))
    .orderBy(desc(driveFileVersions.id))
    .get();
  if (!latest)
    throw new AppError("Version not found", 404, "NOT_FOUND");

  await db.update(driveEntries)
    .set({ displayVersionId: null, fileReferenceId: latest.fileReferenceId, updatedAt: new Date().toISOString() })
    .where(eq(driveEntries.id, entry.id))
    .run();

  const refreshed = await requireEntryRow(db, entry.id);
  return listEntryVersions(db, refreshed);
}

async function requireEntryRow(db: AppDatabase, id: string): Promise<DriveEntryRow> {
  const row = await db.select().from(driveEntries).where(eq(driveEntries.id, id)).get();
  if (!row)
    throw new AppError("Drive entry not found", 404, "NOT_FOUND");
  return row;
}
