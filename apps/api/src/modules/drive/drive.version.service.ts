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
 * The storage driver the entry's CURRENT file lives on. A new version inherits
 * it (FEAT-047), so versions of a db-backed file stay in the DB and versions of
 * an uploaded file stay on its driver. Returns `undefined` when the reference /
 * file cannot be resolved, letting the caller fall back to the default upload
 * driver.
 */
async function currentEntryDriver(db: AppDatabase, entry: DriveEntryRow): Promise<string | undefined> {
  if (!entry.fileReferenceId)
    return undefined;
  const row = await db
    .select({ storageDriver: files.storageDriver })
    .from(fileReferences)
    .innerJoin(files, eq(fileReferences.fileId, files.id))
    .where(eq(fileReferences.id, entry.fileReferenceId))
    .get();
  // A quarantined current file (FIX-062) has no resolvable driver — fall
  // back to the default upload driver instead of inheriting the sentinel.
  if (!row || isQuarantinedFile(row))
    return undefined;
  return row.storageDriver;
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
  const driverName = await currentEntryDriver(db, input.entry);
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: input.entry.id,
    uploadedBy: input.uploadedBy,
    driverName,
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
  const driverName = await currentEntryDriver(db, input.entry);
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: input.entry.id,
    uploadedBy: input.uploadedBy,
    driverName,
  });

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
    await releaseReference(db, config, { referenceId: uploaded.reference.id });
    throw err;
  }

  // Nothing references the old blob now — release it so the coalesced draft's
  // prior bytes do not accrue as orphans.
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
