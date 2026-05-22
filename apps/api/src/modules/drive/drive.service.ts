import type { DriveOwnerType } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  buildDownloadResponse,
  getFileById,
  getReferenceById,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { fileReferences, files } from "@/modules/file/schema";
import { AppError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { driveEntries, driveFileVersions } from "./schema";

export type DriveEntryRow = typeof driveEntries.$inferSelect;

export interface DriveOwner {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
}

export interface DriveEntryView {
  readonly id: string;
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  readonly parentEntryId: string | null;
  readonly type: "folder" | "file";
  readonly name: string;
  readonly favorite: boolean;
  readonly status: "normal" | "trash";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: {
    readonly referenceId: string;
    readonly fileId: string;
    readonly filename: string;
    readonly mimetype: string;
    readonly size: number;
  } | null;
}

export interface ListDriveEntriesInput extends DriveOwner {
  readonly parentEntryId?: string | null | undefined;
  readonly status?: "normal" | "trash" | undefined;
}

export async function listDriveEntries(db: AppDatabase, input: ListDriveEntriesInput): Promise<readonly DriveEntryView[]> {
  const parentEntryId = encodeParentId(input.parentEntryId);
  const status = input.status ?? "normal";

  const rows = await db
    .select({
      entry: driveEntries,
      fileId: fileReferences.fileId,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(
      eq(driveEntries.ownerType, input.ownerType),
      eq(driveEntries.ownerId, input.ownerId),
      eq(driveEntries.parentEntryId, parentEntryId),
      eq(driveEntries.status, status),
    ))
    .orderBy(asc(driveEntries.entryType), asc(driveEntries.name), asc(driveEntries.id))
    .all();

  return rows.map(row => composeDriveEntryView(row));
}

export async function getDriveEntry(
  db: AppDatabase,
  owner: DriveOwner,
  id: string,
): Promise<DriveEntryView | undefined> {
  const row = await db
    .select({
      entry: driveEntries,
      fileId: fileReferences.fileId,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(
      eq(driveEntries.id, id),
      eq(driveEntries.ownerType, owner.ownerType),
      eq(driveEntries.ownerId, owner.ownerId),
    ))
    .get();

  return row ? composeDriveEntryView(row) : undefined;
}

/**
 * Fetch an entry by id regardless of owner. Used by routes that have already
 * cleared the capability check (team-directory / shared access) and so must
 * not re-restrict to the personal owner.
 */
export async function getDriveEntryById(db: AppDatabase, id: string): Promise<DriveEntryView | undefined> {
  const row = await db
    .select({
      entry: driveEntries,
      fileId: fileReferences.fileId,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(eq(driveEntries.id, id))
    .get();
  return row ? composeDriveEntryView(row) : undefined;
}

/** Resolve an entry's real owner (throws 404 when missing). */
export async function getEntryOwner(db: AppDatabase, id: string): Promise<DriveOwner> {
  const row = await db
    .select({ ownerType: driveEntries.ownerType, ownerId: driveEntries.ownerId })
    .from(driveEntries)
    .where(eq(driveEntries.id, id))
    .get();
  if (!row)
    throw new AppError("Drive entry not found", 404, "NOT_FOUND");
  return { ownerType: row.ownerType, ownerId: row.ownerId };
}

const RECENT_LIMIT = 50;

/** The caller's own recently-updated files (normal status), newest first. */
export async function listRecentDriveEntries(db: AppDatabase, userId: string): Promise<readonly DriveEntryView[]> {
  const rows = await db
    .select({
      entry: driveEntries,
      fileId: fileReferences.fileId,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(
      eq(driveEntries.ownerType, "user"),
      eq(driveEntries.ownerId, userId),
      eq(driveEntries.entryType, "file"),
      eq(driveEntries.status, "normal"),
    ))
    .orderBy(desc(driveEntries.updatedAt), desc(driveEntries.id))
    .limit(RECENT_LIMIT)
    .all();
  return rows.map(composeDriveEntryView);
}

/** The caller's own favorited entries (normal status). */
export async function listFavoriteDriveEntries(db: AppDatabase, userId: string): Promise<readonly DriveEntryView[]> {
  const rows = await db
    .select({
      entry: driveEntries,
      fileId: fileReferences.fileId,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(
      eq(driveEntries.ownerType, "user"),
      eq(driveEntries.ownerId, userId),
      eq(driveEntries.favorite, "1"),
      eq(driveEntries.status, "normal"),
    ))
    .orderBy(desc(driveEntries.updatedAt), desc(driveEntries.id))
    .all();
  return rows.map(composeDriveEntryView);
}

export interface CreateDriveFolderInput extends DriveOwner {
  readonly createdBy: string;
  readonly parentEntryId?: string | null | undefined;
  readonly name: string;
}

export async function createDriveFolder(db: AppDatabase, input: CreateDriveFolderInput): Promise<DriveEntryView> {
  const owner: DriveOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
  const parentEntryId = await validateParent(db, owner, input.parentEntryId);
  const id = nanoid();
  const name = normalizeEntryName(input.name);

  try {
    await db.insert(driveEntries).values({
      id,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      parentEntryId,
      entryType: "folder",
      name,
      createdBy: input.createdBy,
    }).run();
  }
  catch (err) {
    throwDuplicateName(err);
    throw err;
  }

  return requireDriveEntry(db, owner, id);
}

export interface UploadDriveFileInput extends DriveOwner {
  readonly createdBy: string;
  readonly parentEntryId?: string | null | undefined;
  readonly file: File;
}

export async function uploadDriveFile(
  db: AppDatabase,
  config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  input: UploadDriveFileInput,
): Promise<DriveEntryView> {
  const owner: DriveOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
  const parentEntryId = await validateParent(db, owner, input.parentEntryId);
  const id = nanoid();
  const name = normalizeEntryName(input.file.name);
  const uploaded = await uploadAndReference(db, config, {
    file: input.file,
    ownerType: "drive_entry",
    ownerId: id,
    uploadedBy: input.createdBy,
    allowAnyType: true,
  });

  try {
    db.transaction((tx) => {
      tx.insert(driveEntries).values({
        id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        parentEntryId,
        entryType: "file",
        name,
        fileReferenceId: uploaded.reference.id,
        createdBy: input.createdBy,
      }).run();
      tx.insert(driveFileVersions).values({
        id: nanoid(),
        driveEntryId: id,
        fileReferenceId: uploaded.reference.id,
        versionNo: 1,
        uploadedBy: input.createdBy,
      }).run();
    });
  }
  catch (err) {
    await releaseReference(db, config, { referenceId: uploaded.reference.id });
    throwDuplicateName(err);
    throw err;
  }

  return requireDriveEntry(db, owner, id);
}

export interface CreateDriveTextFileInput extends DriveOwner {
  readonly createdBy: string;
  readonly parentEntryId?: string | null | undefined;
  readonly name: string;
  readonly content: string;
}

/**
 * Create a server-generated plain-text file entry. The text is persisted
 * through the file module exactly like an upload (so dedupe / GC / download
 * all work uniformly) and a version-1 row is recorded. Always `text/plain`.
 */
export async function createDriveTextFile(
  db: AppDatabase,
  config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  input: CreateDriveTextFileInput,
): Promise<DriveEntryView> {
  const owner: DriveOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
  const parentEntryId = await validateParent(db, owner, input.parentEntryId);
  const id = nanoid();
  const name = normalizeEntryName(input.name);
  const file = new File([input.content], name, { type: "text/plain" });
  const uploaded = await uploadAndReference(db, config, {
    file,
    ownerType: "drive_entry",
    ownerId: id,
    uploadedBy: input.createdBy,
    allowAnyType: true,
  });

  try {
    db.transaction((tx) => {
      tx.insert(driveEntries).values({
        id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        parentEntryId,
        entryType: "file",
        name,
        fileReferenceId: uploaded.reference.id,
        createdBy: input.createdBy,
      }).run();
      tx.insert(driveFileVersions).values({
        id: nanoid(),
        driveEntryId: id,
        fileReferenceId: uploaded.reference.id,
        versionNo: 1,
        uploadedBy: input.createdBy,
      }).run();
    });
  }
  catch (err) {
    await releaseReference(db, config, { referenceId: uploaded.reference.id });
    throwDuplicateName(err);
    throw err;
  }

  return requireDriveEntry(db, owner, id);
}

export interface UpdateDriveEntryInput extends DriveOwner {
  readonly id: string;
  readonly name?: string | undefined;
  readonly parentEntryId?: string | null | undefined;
  readonly favorite?: boolean | undefined;
}

export async function updateDriveEntry(db: AppDatabase, input: UpdateDriveEntryInput): Promise<DriveEntryView> {
  const owner: DriveOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
  const existing = await requireDriveEntryRow(db, owner, input.id);
  const patch: Partial<typeof driveEntries.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined)
    patch.name = normalizeEntryName(input.name);
  if (input.favorite !== undefined)
    patch.favorite = input.favorite ? "1" : "0";
  if (input.parentEntryId !== undefined) {
    patch.parentEntryId = await validateParent(db, owner, input.parentEntryId, existing.id);
  }

  try {
    await db.update(driveEntries)
      .set(patch)
      .where(and(
        eq(driveEntries.id, input.id),
        eq(driveEntries.ownerType, owner.ownerType),
        eq(driveEntries.ownerId, owner.ownerId),
      ))
      .run();
  }
  catch (err) {
    throwDuplicateName(err);
    throw err;
  }

  return requireDriveEntry(db, owner, input.id);
}

export async function trashDriveEntry(db: AppDatabase, owner: DriveOwner, id: string): Promise<void> {
  await requireDriveEntryRow(db, owner, id);
  const ids = await collectEntryTreeIds(db, owner, id);
  await db.update(driveEntries)
    .set({ status: "trash", updatedAt: new Date().toISOString() })
    .where(inArray(driveEntries.id, ids))
    .run();
}

export async function restoreDriveEntry(db: AppDatabase, owner: DriveOwner, id: string): Promise<DriveEntryView> {
  const row = await requireDriveEntryRow(db, owner, id);
  const ids = await collectEntryTreeIds(db, owner, id);
  const parentEntryId = await usableParentAfterRestore(db, owner, row.parentEntryId);

  try {
    db.transaction((tx) => {
      const updatedAt = new Date().toISOString();
      tx.update(driveEntries)
        .set({ status: "normal", updatedAt })
        .where(inArray(driveEntries.id, ids))
        .run();
      if (parentEntryId !== row.parentEntryId) {
        tx.update(driveEntries)
          .set({ parentEntryId, updatedAt })
          .where(eq(driveEntries.id, id))
          .run();
      }
    });
  }
  catch (err) {
    throwDuplicateName(err);
    throw err;
  }

  return requireDriveEntry(db, owner, id);
}

export async function deleteDriveEntryPermanently(
  db: AppDatabase,
  config: Pick<Config, "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  owner: DriveOwner,
  id: string,
): Promise<void> {
  await requireDriveEntryRow(db, owner, id);
  const ids = await collectEntryTreeIds(db, owner, id);
  await purgeEntries(db, config, ids);
}

/**
 * Permanently delete a set of entries and release every file reference they
 * hold — both the current pointer (`driveEntries.fileReferenceId`) and every
 * historical version reference (`drive_file_versions.fileReferenceId`). Refs
 * are de-duplicated so a reference that is simultaneously "current" and a
 * version row is released exactly once. The cascade FK drops version/share
 * child rows when the entries are deleted.
 */
async function purgeEntries(
  db: AppDatabase,
  config: Pick<Config, "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0)
    return;

  const entryRefs = await db
    .select({ id: driveEntries.fileReferenceId })
    .from(driveEntries)
    .where(inArray(driveEntries.id, [...ids]))
    .all();
  const versionRefs = await db
    .select({ id: driveFileVersions.fileReferenceId })
    .from(driveFileVersions)
    .where(inArray(driveFileVersions.driveEntryId, [...ids]))
    .all();

  const refIds = new Set<string>();
  for (const r of entryRefs) {
    if (r.id)
      refIds.add(r.id);
  }
  for (const r of versionRefs)
    refIds.add(r.id);

  await db.delete(driveEntries).where(inArray(driveEntries.id, [...ids])).run();

  for (const refId of refIds)
    await releaseReference(db, config, { referenceId: refId });
}

/**
 * Permanently delete every trashed entry the caller owns and release all
 * their file references. Returns the number of top-level entries removed.
 */
export async function emptyDriveTrash(
  db: AppDatabase,
  config: Pick<Config, "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  owner: DriveOwner,
): Promise<number> {
  const trashed = await db
    .select({ id: driveEntries.id })
    .from(driveEntries)
    .where(and(
      eq(driveEntries.ownerType, owner.ownerType),
      eq(driveEntries.ownerId, owner.ownerId),
      eq(driveEntries.status, "trash"),
    ))
    .all();

  const ids = trashed.map(row => row.id);
  await purgeEntries(db, config, ids);
  return ids.length;
}

export async function buildDriveEntryDownloadResponse(
  db: AppDatabase,
  config: Pick<Config, "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">,
  owner: DriveOwner,
  id: string,
  inline: boolean,
): Promise<Response> {
  const entry = await requireDriveEntryRow(db, owner, id);
  if (entry.entryType !== "file" || !entry.fileReferenceId)
    throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY_TYPE");

  const ref = await getReferenceById(db, entry.fileReferenceId);
  if (!ref)
    throw new AppError("File reference not found", 404, "NOT_FOUND");
  const file = await getFileById(db, ref.fileId);
  if (!file)
    throw new AppError("File not found", 404, "NOT_FOUND");

  return buildDownloadResponse(config, file, ref, { inline });
}

async function requireDriveEntry(db: AppDatabase, owner: DriveOwner, id: string): Promise<DriveEntryView> {
  const entry = await getDriveEntry(db, owner, id);
  if (!entry)
    throw new AppError("Drive entry not found", 404, "NOT_FOUND");
  return entry;
}

async function requireDriveEntryRow(db: AppDatabase, owner: DriveOwner, id: string): Promise<DriveEntryRow> {
  const entry = await db.select().from(driveEntries).where(and(
    eq(driveEntries.id, id),
    eq(driveEntries.ownerType, owner.ownerType),
    eq(driveEntries.ownerId, owner.ownerId),
  )).get();
  if (!entry)
    throw new AppError("Drive entry not found", 404, "NOT_FOUND");
  return entry;
}

async function validateParent(
  db: AppDatabase,
  owner: DriveOwner,
  parentEntryId: string | null | undefined,
  movingEntryId?: string,
): Promise<string> {
  const normalized = encodeParentId(parentEntryId);
  if (!normalized)
    return "";
  if (normalized === movingEntryId)
    throw new AppError("Cannot move an entry into itself", 400, "INVALID_PARENT");

  const parent = await requireDriveEntryRow(db, owner, normalized);
  if (parent.entryType !== "folder" || parent.status !== "normal")
    throw new AppError("Parent entry must be an active folder", 400, "INVALID_PARENT");

  if (movingEntryId) {
    const descendants = await collectEntryTreeIds(db, owner, movingEntryId);
    if (descendants.includes(normalized))
      throw new AppError("Cannot move an entry into its descendant", 400, "INVALID_PARENT");
  }
  return normalized;
}

async function usableParentAfterRestore(db: AppDatabase, owner: DriveOwner, parentEntryId: string): Promise<string> {
  if (!parentEntryId)
    return "";

  const parent = await db.select().from(driveEntries).where(and(
    eq(driveEntries.id, parentEntryId),
    eq(driveEntries.ownerType, owner.ownerType),
    eq(driveEntries.ownerId, owner.ownerId),
  )).get();
  return parent?.status === "normal" && parent.entryType === "folder" ? parent.id : "";
}

async function collectEntryTreeIds(db: AppDatabase, owner: DriveOwner, rootId: string): Promise<string[]> {
  const ids: string[] = [rootId];
  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await db
      .select({ id: driveEntries.id })
      .from(driveEntries)
      .where(and(
        eq(driveEntries.ownerType, owner.ownerType),
        eq(driveEntries.ownerId, owner.ownerId),
        inArray(driveEntries.parentEntryId, frontier),
        ne(driveEntries.id, rootId),
      ))
      .all();
    frontier = children.map(child => child.id);
    ids.push(...frontier);
  }

  return ids;
}

function composeDriveEntryView(row: {
  readonly entry: DriveEntryRow;
  readonly fileId: string | null;
  readonly filename: string | null;
  readonly mimetype: string | null;
  readonly size: number | null;
}): DriveEntryView {
  const entry = row.entry;
  return {
    id: entry.id,
    ownerType: entry.ownerType,
    ownerId: entry.ownerId,
    parentEntryId: decodeParentId(entry.parentEntryId),
    type: entry.entryType,
    name: entry.name,
    favorite: entry.favorite === "1",
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    file: entry.fileReferenceId && row.fileId && row.filename && row.mimetype && row.size !== null
      ? {
          referenceId: entry.fileReferenceId,
          fileId: row.fileId,
          filename: row.filename,
          mimetype: row.mimetype,
          size: row.size,
        }
      : null,
  };
}

function normalizeEntryName(value: string): string {
  const name = value.trim();
  if (!name)
    throw new AppError("Drive entry name is required", 400, "VALIDATION_ERROR");
  if (name.includes("/") || name.includes("\\"))
    throw new AppError("Drive entry name cannot contain path separators", 400, "VALIDATION_ERROR");
  if (name.length > 255)
    throw new AppError("Drive entry name is too long", 400, "VALIDATION_ERROR");
  return name;
}

function encodeParentId(parentEntryId: string | null | undefined): string {
  return parentEntryId?.trim() || "";
}

function decodeParentId(parentEntryId: string): string | null {
  return parentEntryId || null;
}

function throwDuplicateName(err: unknown): never | void {
  if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
    throw new AppError("A drive entry with this name already exists in the target folder", 409, "DUPLICATE_NAME");
  }
}
