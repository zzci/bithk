import type { DriveEntryRow } from "./drive.service";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { and, desc, eq, max } from "drizzle-orm";
import { releaseReference, uploadAndReference } from "@/modules/file";
import { fileReferences, files } from "@/modules/file/schema";
import { AppError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { driveEntries, driveFileVersions } from "./schema";

export interface DriveVersionView {
  readonly id: string;
  readonly versionNo: number;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
  /** True when this version's reference is the entry's current pointer. */
  readonly isCurrent: boolean;
}

type UploadConfig = Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">;

function assertFileEntry(entry: DriveEntryRow): void {
  if (entry.entryType !== "file" || !entry.fileReferenceId)
    throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY_TYPE");
}

/** Versions for a file entry, newest first, each flagged with `isCurrent`. */
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
    .orderBy(desc(driveFileVersions.versionNo))
    .all();

  return rows.map(row => ({
    id: row.version.id,
    versionNo: row.version.versionNo,
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
 * Upload a new version of an existing file entry: stores a fresh blob
 * reference, appends a `drive_file_versions` row (`versionNo = max + 1`) and
 * switches the entry's current pointer to it. The previous version's
 * reference is kept (released only on permanent delete). On any failure the
 * just-uploaded reference is released so no orphan accrues.
 */
export async function uploadEntryVersion(
  db: AppDatabase,
  config: UploadConfig,
  input: UploadEntryVersionInput,
): Promise<readonly DriveVersionView[]> {
  assertFileEntry(input.entry);
  // Read the snapshot text before the transaction so the live content slot can
  // be set to the just-saved version — GET /content (which prefers the live
  // body) then returns this snapshot instead of a now-stale autosave draft.
  const body = await input.file.text();
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: input.entry.id,
    uploadedBy: input.uploadedBy,
  });

  try {
    db.transaction((tx) => {
      const top = tx
        .select({ value: max(driveFileVersions.versionNo) })
        .from(driveFileVersions)
        .where(eq(driveFileVersions.driveEntryId, input.entry.id))
        .get();
      const versionNo = (top?.value ?? 0) + 1;
      tx.insert(driveFileVersions).values({
        id: nanoid(),
        driveEntryId: input.entry.id,
        fileReferenceId: uploaded.reference.id,
        versionNo,
        uploadedBy: input.uploadedBy,
      }).run();
      tx.update(driveEntries)
        .set({ fileReferenceId: uploaded.reference.id, currentContentBody: body, updatedAt: new Date().toISOString() })
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

/** Point the entry's current reference at an existing version. */
export async function switchEntryVersion(
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

  // Clear the live content slot on switch: with `currentContentBody = null` the
  // content-read path falls back to the (now-switched) versioned blob, so
  // GET /content returns the chosen version. This also discards any unsaved
  // autosave draft — switching versions is an explicit overwrite. Avoids
  // re-reading the blob bytes here (no file-module text helper is exported).
  await db.update(driveEntries)
    .set({ fileReferenceId: version.fileReferenceId, currentContentBody: null, updatedAt: new Date().toISOString() })
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
