import type { Context } from "hono";
import type { AppDatabase } from "@/db";
import type {
  PublicShareListing,
  ShareAdapter,
  ShareContent,
  ShareResolved,
} from "@/modules/share";
import type { AppEnv } from "@/shared/lib/types";
import { and, eq } from "drizzle-orm";
import { fileReferences, files } from "@/modules/file/schema";
import { registerShareAdapter } from "@/modules/share";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { assertEntryCapability } from "./drive.permission";
import { driveEntries } from "./schema";

function actorOf(c: Context<AppEnv>) {
  const user = c.get("user")!;
  return { id: user.id, role: user.role };
}

async function resolve(db: AppDatabase, entryId: string): Promise<ShareResolved | null> {
  const row = await db
    .select({
      name: driveEntries.name,
      entryType: driveEntries.entryType,
      status: driveEntries.status,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(eq(driveEntries.id, entryId))
    .get();
  if (!row || row.status !== "normal")
    return null;
  return {
    name: row.name,
    isFolder: row.entryType === "folder",
    file: row.filename && row.mimetype && row.size !== null
      ? { filename: row.filename, mimetype: row.mimetype, size: row.size }
      : null,
  };
}

/**
 * Walk parent links from `entryId` up to `rootId`. Bounded to guard against
 * cycles. Returns the breadcrumb (root→…→entry) when within the subtree, or
 * null when `entryId` is not the root or one of its descendants.
 */
async function resolveSubtreePath(
  db: AppDatabase,
  entryId: string,
  rootId: string,
  rootName: string,
): Promise<{ readonly id: string; readonly name: string }[] | null> {
  if (entryId === rootId)
    return [{ id: rootId, name: rootName }];
  const chain: { readonly id: string; readonly name: string }[] = [];
  let currentId = entryId;
  for (let depth = 0; depth < 64; depth++) {
    const row = await db
      .select({ id: driveEntries.id, name: driveEntries.name, parentEntryId: driveEntries.parentEntryId, status: driveEntries.status })
      .from(driveEntries)
      .where(eq(driveEntries.id, currentId))
      .get();
    if (!row || row.status !== "normal")
      return null;
    chain.unshift({ id: row.id, name: row.name });
    if (row.parentEntryId === rootId)
      return [{ id: rootId, name: rootName }, ...chain];
    if (!row.parentEntryId)
      return null;
    currentId = row.parentEntryId;
  }
  return null;
}

async function fileOfEntry(db: AppDatabase, entryId: string): Promise<ShareContent> {
  const entry = await db.select().from(driveEntries).where(eq(driveEntries.id, entryId)).get();
  if (!entry || entry.status !== "normal" || entry.entryType !== "file" || !entry.fileReferenceId)
    throw new NotFoundError("Shared file", entryId);
  const reference = await db.select().from(fileReferences).where(eq(fileReferences.id, entry.fileReferenceId)).get();
  if (!reference)
    throw new NotFoundError("Shared file", entryId);
  const file = await db.select().from(files).where(eq(files.id, reference.fileId)).get();
  if (!file)
    throw new NotFoundError("Shared file", entryId);
  return { file, reference };
}

const adapter: ShareAdapter = {
  resourceType: "drive_entry",
  capabilities: {
    shareTypes: ["direct", "public_link"],
    permissions: ["view", "download", "edit"],
  },

  authorizeManage: async (c, resourceId) => {
    await assertEntryCapability(c.get("db"), actorOf(c), resourceId, "share");
  },

  resolve,

  // After the gate passes, hand the client the unlocked descriptor so it can
  // render a download button (single file) or a folder browser.
  getContent: async (db, share) => {
    const resolved = await resolve(db, share.resourceId);
    if (!resolved)
      throw new NotFoundError("Shared file", share.resourceId);
    return { ...resolved, permission: share.permission };
  },

  listChildren: async (db, share, parentId): Promise<PublicShareListing> => {
    const root = await resolve(db, share.resourceId);
    if (!root || !root.isFolder)
      throw new AppError("Share is not a folder", 400, "INVALID_ENTRY_TYPE");

    const target = parentId ?? share.resourceId;
    const breadcrumb = await resolveSubtreePath(db, target, share.resourceId, root.name);
    if (!breadcrumb)
      throw new NotFoundError("Folder", target);

    const rows = await db
      .select({
        id: driveEntries.id,
        name: driveEntries.name,
        entryType: driveEntries.entryType,
        mimetype: files.mimetype,
        size: files.size,
      })
      .from(driveEntries)
      .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
      .leftJoin(files, eq(fileReferences.fileId, files.id))
      .where(and(eq(driveEntries.parentEntryId, target), eq(driveEntries.status, "normal")))
      .all();

    const entries = rows
      .map(r => ({ id: r.id, name: r.name, type: r.entryType, size: r.size, mimetype: r.mimetype }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));

    return { breadcrumb, entries };
  },

  openFile: async (db, share, childId): Promise<ShareContent> => {
    if (share.permission === "view")
      throw new ForbiddenError("This link is view-only");

    // Folder share: the requested child must live inside the shared subtree.
    if (childId !== undefined) {
      const root = await resolve(db, share.resourceId);
      if (!root || !root.isFolder)
        throw new AppError("Share is not a folder", 400, "INVALID_ENTRY_TYPE");
      const child = await db.select({ parentEntryId: driveEntries.parentEntryId }).from(driveEntries).where(eq(driveEntries.id, childId)).get();
      if (!child)
        throw new NotFoundError("Shared file", childId);
      const path = await resolveSubtreePath(db, child.parentEntryId ?? "", share.resourceId, root.name);
      if (!path)
        throw new NotFoundError("Shared file", childId);
      return fileOfEntry(db, childId);
    }

    // Single-file share.
    return fileOfEntry(db, share.resourceId);
  },
};

registerShareAdapter(adapter);
