import type { AppDatabase } from "@/db";
import { and, count, desc, eq } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { driveEntries, UNIVER_SHEET_MIME } from "@/modules/drive/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { ulidTimeMs } from "@/shared/lib/id";
import { newStorageKey } from "./storage/key";
import { getDriver } from "./storage/registry";

export interface StorageFileView {
  readonly id: string;
  /** Owning drive entry's display name, else the reference filename, else the file id. */
  readonly name: string;
  /** Owning drive entry id, when this file is attached to one. */
  readonly entryId: string | null;
  /** The drive entry's owner scope (`user` / `team_directory` / `project`), when resolvable. */
  readonly ownerScope: string | null;
  readonly mimetype: string;
  readonly size: number;
  readonly storageDriver: string;
  readonly uploadedByName: string;
  readonly createdAt: string | null;
}

export interface StorageFilePage {
  readonly data: readonly StorageFileView[];
  readonly total: number;
}

/**
 * One page of `files` rows, LEFT-joined to their owning drive entry (via
 * `file_references.owner_type='drive_entry'`), for the admin Storage list.
 * Files with no drive-entry owner (avatars, issue/document attachments) are
 * still listed with a null entry. Newest-first by `files.id` (ULID).
 */
export async function listStorageFiles(db: AppDatabase, page: number, limit: number): Promise<StorageFilePage> {
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: files.id,
      mimetype: files.mimetype,
      size: files.size,
      storageDriver: files.storageDriver,
      uploaderName: users.name,
      uploaderUsername: users.username,
      entryId: driveEntries.id,
      entryName: driveEntries.name,
      entryCreatedAt: driveEntries.createdAt,
      ownerScope: driveEntries.ownerType,
      refFilename: fileReferences.filename,
    })
    .from(files)
    .leftJoin(users, eq(files.uploadedBy, users.id))
    .leftJoin(fileReferences, and(eq(fileReferences.fileId, files.id), eq(fileReferences.ownerType, "drive_entry")))
    .leftJoin(driveEntries, eq(driveEntries.fileReferenceId, fileReferences.id))
    .orderBy(desc(files.id))
    .limit(limit)
    .offset(offset)
    .all();

  const totalRow = await db.select({ value: count() }).from(files).get();

  const data = rows.map<StorageFileView>(r => ({
    id: r.id,
    name: r.entryName || r.refFilename || r.id,
    entryId: r.entryId ?? null,
    ownerScope: r.ownerScope ?? null,
    mimetype: r.mimetype,
    size: r.size,
    storageDriver: r.storageDriver,
    uploadedByName: r.uploaderName || r.uploaderUsername || "—",
    createdAt: r.entryCreatedAt ?? null,
  }));

  return { data, total: totalRow?.value ?? 0 };
}

export interface SyncToS3Summary {
  readonly moved: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Move every non-spreadsheet `files` row not already on S3 to the S3 backend:
 * read the bytes via the row's current driver, `put` them to S3 under an
 * hour-based key bucketed by the blob's ORIGINAL upload hour (its row-id ULID
 * mint time), repoint `storage_driver='s3'` + `storage_key`, then
 * delete the old blob via the old driver. Spreadsheets (`UNIVER_SHEET_MIME`)
 * are skipped so their live-editable snapshot stays in the DB. Requires S3 to
 * be configured (the caller checks). Returns a `{ moved, skipped, failed }`
 * summary. A single row failure is counted and the sweep continues.
 */
export async function syncNonSpreadsheetsToS3(db: AppDatabase): Promise<SyncToS3Summary> {
  const rows = await db
    .select({
      id: files.id,
      sha256: files.sha256,
      mimetype: files.mimetype,
      storageDriver: files.storageDriver,
      storageKey: files.storageKey,
    })
    .from(files)
    .all();

  const target = getDriver("s3");
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.storageDriver === "s3" || row.mimetype === UNIVER_SHEET_MIME) {
      skipped++;
      continue;
    }
    try {
      const source = getDriver(row.storageDriver);
      const stream = await source.getStream(row.storageKey);
      const bytes = await new Response(stream).arrayBuffer();
      // Bucket by the blob's ORIGINAL upload hour (its row-id ULID mint time),
      // not now — so the storage layout reflects real upload times and matches
      // the rekey migration script. Falls back to now for a non-ULID id.
      const newKey = newStorageKey(row.id, ulidTimeMs(row.id) ?? Date.now());
      await target.put(newKey, bytes, { contentType: row.mimetype });

      await db.update(files)
        .set({ storageDriver: "s3", storageKey: newKey })
        .where(eq(files.id, row.id))
        .run();

      // Delete the old blob via its old driver (tolerant of a missing object).
      await source.delete(row.storageKey);
      moved++;
    }
    catch {
      failed++;
    }
  }

  return { moved, skipped, failed };
}
