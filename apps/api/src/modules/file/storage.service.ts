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

export interface SyncToS3Options {
  /** Report what would move without reading, writing, or repointing. */
  readonly dryRun?: boolean;
  /** Per-row progress callback (for the CLI). */
  readonly onProgress?: (event: { readonly kind: "moved" | "skipped" | "failed"; readonly id: string; readonly from?: string; readonly to?: string; readonly err?: string }) => void;
}

/** The canonical hour-based key for a row: its ORIGINAL upload hour + id. */
function targetKeyFor(id: string): string {
  // Bucket by the blob's ORIGINAL upload hour (its row-id ULID mint time), not
  // now — so the storage layout reflects real upload times and matches the
  // rekey migration script. Falls back to now for a non-ULID id.
  return newStorageKey(id, ulidTimeMs(id) ?? Date.now());
}

/**
 * Move every non-spreadsheet `files` row that is NOT already an S3 object at
 * its canonical hour-based key onto S3: read the bytes via the row's current
 * driver, `put` them to S3 under `YYYYMMDDHH/<ulid>` (original upload hour),
 * repoint `storage_driver='s3'` + `storage_key`, then delete the old blob via
 * the old driver. This is idempotent and covers BOTH migrations in one pass —
 * a local/db blob is moved to S3, and an S3 blob still on the legacy
 * `ab/cd/<sha256>` key is re-keyed in place (the `s3://old → s3://new` copy is
 * a normal put+delete). Spreadsheets (`UNIVER_SHEET_MIME`) stay in the DB so
 * their live-editable snapshot survives; quarantined rows have no bytes to
 * move. Requires S3 configured (caller checks). A single row failure is
 * counted and the sweep continues. `dryRun` reports without touching anything.
 */
export async function syncNonSpreadsheetsToS3(db: AppDatabase, opts: SyncToS3Options = {}): Promise<SyncToS3Summary> {
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
    const canonicalKey = targetKeyFor(row.id);
    // Already an S3 object at its canonical key, a live-editable spreadsheet,
    // or a quarantined row (no backing bytes) — nothing to do.
    if (
      (row.storageDriver === "s3" && row.storageKey === canonicalKey)
      || row.mimetype === UNIVER_SHEET_MIME
      || row.storageDriver.startsWith("quarantined:")
    ) {
      skipped++;
      continue;
    }
    if (opts.dryRun) {
      moved++;
      opts.onProgress?.({ kind: "moved", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, to: `s3:${canonicalKey}` });
      continue;
    }
    try {
      const source = getDriver(row.storageDriver);
      const stream = await source.getStream(row.storageKey);
      const bytes = await new Response(stream).arrayBuffer();
      await target.put(canonicalKey, bytes, { contentType: row.mimetype });

      await db.update(files)
        .set({ storageDriver: "s3", storageKey: canonicalKey })
        .where(eq(files.id, row.id))
        .run();

      // Delete the old blob via its old driver (tolerant of a missing object).
      // Skip when the source IS the same s3 key (can't happen — canonicalKey
      // differs whenever we reach here — but stay defensive).
      if (!(row.storageDriver === "s3" && row.storageKey === canonicalKey))
        await source.delete(row.storageKey);
      moved++;
      opts.onProgress?.({ kind: "moved", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, to: `s3:${canonicalKey}` });
    }
    catch (err) {
      failed++;
      opts.onProgress?.({ kind: "failed", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { moved, skipped, failed };
}

/**
 * Move every Univer spreadsheet (`UNIVER_SHEET_MIME`) that is NOT already on
 * the `db` driver onto it. Spreadsheets are the live-editable snapshot and
 * must live in the database, but historical rows (pre-`db`-driver, or restored
 * from a backup) can sit on `local`/`s3`. Per row: read the bytes via the
 * row's current driver, `put` them to the `db` driver under a fresh hour-based
 * key, repoint `storage_driver='db'` + `storage_key`, then delete the old
 * blob. The inverse of {@link syncNonSpreadsheetsToS3} (which skips sheets).
 * Idempotent; quarantined rows are skipped; a single failure is counted and
 * the sweep continues. `dryRun` reports without touching anything.
 */
export async function syncSpreadsheetsToDb(db: AppDatabase, opts: SyncToS3Options = {}): Promise<SyncToS3Summary> {
  const rows = await db
    .select({
      id: files.id,
      mimetype: files.mimetype,
      storageDriver: files.storageDriver,
      storageKey: files.storageKey,
    })
    .from(files)
    .all();

  const target = getDriver("db");
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.mimetype !== UNIVER_SHEET_MIME || row.storageDriver === "db" || row.storageDriver.startsWith("quarantined:")) {
      skipped++;
      continue;
    }
    const newKey = targetKeyFor(row.id);
    if (opts.dryRun) {
      moved++;
      opts.onProgress?.({ kind: "moved", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, to: `db:${newKey}` });
      continue;
    }
    try {
      const source = getDriver(row.storageDriver);
      const stream = await source.getStream(row.storageKey);
      const bytes = await new Response(stream).arrayBuffer();
      await target.put(newKey, bytes, { contentType: row.mimetype });

      await db.update(files)
        .set({ storageDriver: "db", storageKey: newKey })
        .where(eq(files.id, row.id))
        .run();

      await source.delete(row.storageKey);
      moved++;
      opts.onProgress?.({ kind: "moved", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, to: `db:${newKey}` });
    }
    catch (err) {
      failed++;
      opts.onProgress?.({ kind: "failed", id: row.id, from: `${row.storageDriver}:${row.storageKey}`, err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { moved, skipped, failed };
}
