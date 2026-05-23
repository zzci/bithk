import type { SQL } from "drizzle-orm";
import type { DriveEntryRow } from "./drive.service";
import type { DriveSharePermission, DriveShareType } from "./schema";
import type { AppDatabase } from "@/db";
import type { FileReferenceRow, FileRow } from "@/modules/file/file.service";
import { and, desc, eq } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { driveEntries, driveFileShares } from "./schema";

export type DriveShareRow = typeof driveFileShares.$inferSelect;

export interface DriveShareView {
  readonly id: string;
  readonly driveEntryId: string;
  readonly entryName: string;
  readonly token: string;
  readonly shareType: DriveShareType;
  readonly sharedWithUserId: string | null;
  readonly permission: DriveSharePermission;
  readonly hasPassword: boolean;
  readonly expiresAt: string | null;
  readonly maxDownloads: number | null;
  readonly downloadCount: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: {
    readonly filename: string;
    readonly mimetype: string;
    readonly size: number;
  } | null;
}

/** Public-facing share metadata — never leaks bytes or the password hash. */
export interface PublicShareMeta {
  readonly token: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly permission: DriveSharePermission;
  readonly requiresPassword: boolean;
  readonly expired: boolean;
  readonly exhausted: boolean;
  /** True when the share points at a folder (browse via the listing routes). */
  readonly isFolder: boolean;
}

/** One entry inside a publicly shared folder. */
export interface PublicShareEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "file" | "folder";
  readonly size: number | null;
  readonly mimetype: string | null;
}

/**
 * A listing within a shared folder subtree: the entries plus a breadcrumb
 *  from the shared root (index 0) down to the listed folder.
 */
export interface PublicShareListing {
  readonly breadcrumb: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly PublicShareEntry[];
}

export type PublicShareAccess
  = | { readonly kind: "download"; readonly file: FileRow; readonly reference: FileReferenceRow }
    | { readonly kind: "view"; readonly meta: PublicShareMeta };

/** Short url-safe token — `nanoid(10)`, unguessable and unique per share. */
function generateShareToken(): string {
  return nanoid(10);
}

/** Whether an active share of the given kind already exists for an entry. */
async function hasActiveShare(
  db: AppDatabase,
  entryId: string,
  shareType: DriveShareType,
  sharedWithUserId?: string,
): Promise<boolean> {
  const row = await db
    .select({ id: driveFileShares.id })
    .from(driveFileShares)
    .where(and(
      eq(driveFileShares.driveEntryId, entryId),
      eq(driveFileShares.shareType, shareType),
      eq(driveFileShares.isActive, 1),
      ...(sharedWithUserId ? [eq(driveFileShares.sharedWithUserId, sharedWithUserId)] : []),
    )!)
    .get();
  return row !== undefined;
}

function assertShareableEntry(entry: DriveEntryRow): void {
  if (entry.entryType === "file" && entry.fileReferenceId)
    return;
  if (entry.entryType === "folder")
    return;
  throw new AppError("Only files or folders can be shared", 400, "INVALID_ENTRY_TYPE");
}

export interface CreateShareInput {
  readonly entry: DriveEntryRow;
  readonly createdBy: string;
  readonly shareType: DriveShareType;
  readonly permission: DriveSharePermission;
  readonly sharedWithUserId?: string | undefined;
  readonly password?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly maxDownloads?: number | null | undefined;
}

export async function createShare(db: AppDatabase, input: CreateShareInput): Promise<DriveShareView> {
  assertShareableEntry(input.entry);

  let sharedWithUserId: string | null = null;
  let password: string | null = null;
  let expiresAt: string | null = null;
  let maxDownloads: number | null = null;

  if (input.shareType === "direct") {
    if (!input.sharedWithUserId)
      throw new AppError("sharedWithUserId is required for a direct share", 400, "VALIDATION_ERROR");
    const recipient = await db.select({ id: users.id }).from(users).where(eq(users.id, input.sharedWithUserId)).get();
    if (!recipient)
      throw new NotFoundError("Recipient", input.sharedWithUserId);
    if (input.sharedWithUserId === input.createdBy)
      throw new AppError("Cannot share an entry with yourself", 400, "VALIDATION_ERROR");
    // One active direct share per (entry, recipient) — no duplicate grants.
    if (await hasActiveShare(db, input.entry.id, "direct", input.sharedWithUserId))
      throw new AppError("This entry is already shared with that user", 409, "SHARE_EXISTS");
    sharedWithUserId = input.sharedWithUserId;
  }
  else {
    // public_link — at most one active link per entry, never multiple.
    if (await hasActiveShare(db, input.entry.id, "public_link"))
      throw new AppError("A public link already exists for this entry", 409, "SHARE_EXISTS");
    if (input.password)
      password = await Bun.password.hash(input.password);
    expiresAt = input.expiresAt ?? null;
    maxDownloads = input.maxDownloads ?? null;
  }

  const id = nanoid();
  await db.insert(driveFileShares).values({
    id,
    driveEntryId: input.entry.id,
    token: generateShareToken(),
    shareType: input.shareType,
    sharedWithUserId,
    permission: input.permission,
    password,
    expiresAt,
    maxDownloads,
    createdBy: input.createdBy,
  }).run();

  return requireShareView(db, id);
}

export async function listSharesForEntry(db: AppDatabase, entryId: string): Promise<readonly DriveShareView[]> {
  return queryShareViews(db, and(
    eq(driveFileShares.driveEntryId, entryId),
    eq(driveFileShares.isActive, 1),
  )!);
}

export interface UpdateShareInput {
  readonly permission?: DriveSharePermission | undefined;
  readonly password?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly maxDownloads?: number | null | undefined;
  readonly isActive?: boolean | undefined;
}

export async function updateShare(db: AppDatabase, shareId: string, userId: string, input: UpdateShareInput): Promise<DriveShareView> {
  const share = await requireOwnedShare(db, shareId, userId);

  const patch: Partial<typeof driveFileShares.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.permission !== undefined)
    patch.permission = input.permission;
  if (input.expiresAt !== undefined)
    patch.expiresAt = input.expiresAt ?? null;
  if (input.maxDownloads !== undefined)
    patch.maxDownloads = input.maxDownloads ?? null;
  if (input.isActive !== undefined)
    patch.isActive = input.isActive ? 1 : 0;
  if (input.password !== undefined) {
    if (share.shareType !== "public_link")
      throw new AppError("Only public links carry a password", 400, "VALIDATION_ERROR");
    patch.password = input.password ? await Bun.password.hash(input.password) : null;
  }

  await db.update(driveFileShares).set(patch).where(eq(driveFileShares.id, shareId)).run();
  return requireShareView(db, shareId);
}

export async function revokeShare(db: AppDatabase, shareId: string, userId: string): Promise<void> {
  await requireOwnedShare(db, shareId, userId);
  await db.update(driveFileShares)
    .set({ isActive: 0, updatedAt: new Date().toISOString() })
    .where(eq(driveFileShares.id, shareId))
    .run();
}

/** Active direct shares where the caller is the recipient. */
export async function listReceivedShares(db: AppDatabase, userId: string): Promise<readonly DriveShareView[]> {
  return queryShareViews(db, and(
    eq(driveFileShares.sharedWithUserId, userId),
    eq(driveFileShares.shareType, "direct"),
    eq(driveFileShares.isActive, 1),
    eq(driveEntries.status, "normal"),
  )!);
}

/** Active direct shares created by the caller (revoked ones are dropped). */
export async function listSentShares(db: AppDatabase, userId: string): Promise<readonly DriveShareView[]> {
  return queryShareViews(db, and(
    eq(driveFileShares.createdBy, userId),
    eq(driveFileShares.shareType, "direct"),
    eq(driveFileShares.isActive, 1),
  )!);
}

/** Active public-link shares created by the caller (revoked ones are dropped). */
export async function listLinkShares(db: AppDatabase, userId: string): Promise<readonly DriveShareView[]> {
  return queryShareViews(db, and(
    eq(driveFileShares.createdBy, userId),
    eq(driveFileShares.shareType, "public_link"),
    eq(driveFileShares.isActive, 1),
  )!);
}

interface ShareJoinRow {
  readonly share: DriveShareRow;
  readonly entryName: string;
  readonly entryType: "file" | "folder";
  readonly filename: string | null;
  readonly mimetype: string | null;
  readonly size: number | null;
}

async function getPublicShareJoin(db: AppDatabase, token: string): Promise<ShareJoinRow | undefined> {
  return db
    .select({
      share: driveFileShares,
      entryName: driveEntries.name,
      entryType: driveEntries.entryType,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveFileShares)
    .innerJoin(driveEntries, eq(driveFileShares.driveEntryId, driveEntries.id))
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(
      eq(driveFileShares.token, token),
      eq(driveFileShares.shareType, "public_link"),
    ))
    .get();
}

function isExpired(share: DriveShareRow): boolean {
  return share.expiresAt !== null && new Date(share.expiresAt).getTime() < Date.now();
}

function isExhausted(share: DriveShareRow): boolean {
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads;
}

function toPublicMeta(row: ShareJoinRow): PublicShareMeta {
  return {
    token: row.share.token,
    filename: row.filename ?? row.entryName,
    mimetype: row.mimetype ?? "application/octet-stream",
    size: row.size ?? 0,
    permission: row.share.permission,
    requiresPassword: row.share.password !== null,
    expired: isExpired(row.share),
    exhausted: isExhausted(row.share),
    isFolder: row.entryType === "folder",
  };
}

/** Public GET — metadata only, no bytes, no password hash. */
export async function getPublicShareMeta(db: AppDatabase, token: string): Promise<PublicShareMeta> {
  const row = await getPublicShareJoin(db, token);
  if (!row || row.share.isActive !== 1)
    throw new NotFoundError("Share link", token);
  return toPublicMeta(row);
}

/**
 * Public POST — verify password, enforce expiry / exhaustion, then either
 * grant a download (incrementing the counter atomically) or return view-only
 * metadata. The counter increment is a conditional update inside a
 * synchronous transaction, so concurrent requests can never push
 * `downloadCount` past `maxDownloads`.
 */
export async function accessPublicShare(
  db: AppDatabase,
  token: string,
  password: string | undefined,
): Promise<PublicShareAccess> {
  const row = await getPublicShareJoin(db, token);
  if (!row || row.share.isActive !== 1)
    throw new NotFoundError("Share link", token);

  const share = row.share;
  if (isExpired(share))
    throw new AppError("Share link has expired", 410, "SHARE_EXPIRED");
  if (isExhausted(share))
    throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");

  if (share.password !== null) {
    if (!password)
      throw new ForbiddenError("Password required");
    const valid = await Bun.password.verify(password, share.password);
    if (!valid)
      throw new ForbiddenError("Invalid password");
  }

  // Folder shares are browsed through the listing routes, not downloaded as a
  // single blob; the base POST only confirms access (password/expiry).
  if (row.entryType === "folder")
    return { kind: "view", meta: toPublicMeta(row) };

  // View-only links never expose bytes.
  if (share.permission === "view")
    return { kind: "view", meta: toPublicMeta(row) };

  // Atomic, race-safe download-count increment.
  const reserved = db.transaction((tx) => {
    const current = tx
      .select({ downloadCount: driveFileShares.downloadCount, maxDownloads: driveFileShares.maxDownloads, isActive: driveFileShares.isActive })
      .from(driveFileShares)
      .where(eq(driveFileShares.id, share.id))
      .get();
    if (!current || current.isActive !== 1)
      return false;
    if (current.maxDownloads !== null && current.downloadCount >= current.maxDownloads)
      return false;
    tx.update(driveFileShares)
      .set({ downloadCount: current.downloadCount + 1 })
      .where(eq(driveFileShares.id, share.id))
      .run();
    return true;
  });
  if (!reserved)
    throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");

  const entry = await db.select().from(driveEntries).where(eq(driveEntries.id, share.driveEntryId)).get();
  if (!entry || !entry.fileReferenceId)
    throw new NotFoundError("Shared file");
  const ref = await db.select().from(fileReferences).where(eq(fileReferences.id, entry.fileReferenceId)).get();
  if (!ref)
    throw new NotFoundError("Shared file");
  const file = await db.select().from(files).where(eq(files.id, ref.fileId)).get();
  if (!file)
    throw new NotFoundError("Shared file");

  return { kind: "download", file, reference: ref };
}

// ─── Public folder shares ─────────────────────────────────────────────────

/**
 * Resolve + gate an active public-link share (password / expiry), throwing
 *  the same errors the single-file path uses. Returns the joined row.
 */
async function gatePublicShare(
  db: AppDatabase,
  token: string,
  password: string | undefined,
): Promise<ShareJoinRow> {
  const row = await getPublicShareJoin(db, token);
  if (!row || row.share.isActive !== 1)
    throw new NotFoundError("Share link", token);
  if (isExpired(row.share))
    throw new AppError("Share link has expired", 410, "SHARE_EXPIRED");
  if (isExhausted(row.share))
    throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");
  if (row.share.password !== null) {
    if (!password)
      throw new ForbiddenError("Password required");
    if (!(await Bun.password.verify(password, row.share.password)))
      throw new ForbiddenError("Invalid password");
  }
  return row;
}

/**
 * Walk parent links from `entryId` up to `rootId`. Bounded to guard against
 *  cycles. Returns the breadcrumb (root→…→entry) when within the subtree,
 *  or null when `entryId` is not the root or one of its descendants.
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

/**
 * List the entries directly under a folder inside a public folder share. The
 * folder defaults to the shared root; any other `parentEntryId` must be a
 * descendant of the shared root (subtree-scoped — no traversal to siblings or
 * parents of the shared folder).
 */
export async function listPublicShareEntries(
  db: AppDatabase,
  token: string,
  password: string | undefined,
  parentEntryId: string | undefined,
): Promise<PublicShareListing> {
  const row = await gatePublicShare(db, token, password);
  if (row.entryType !== "folder")
    throw new AppError("Share is not a folder", 400, "INVALID_ENTRY_TYPE");

  const rootId = row.share.driveEntryId;
  const target = parentEntryId ?? rootId;
  const breadcrumb = await resolveSubtreePath(db, target, rootId, row.entryName);
  if (!breadcrumb)
    throw new NotFoundError("Folder", target);

  const rows = await db
    .select({
      id: driveEntries.id,
      name: driveEntries.name,
      entryType: driveEntries.entryType,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveEntries)
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(and(eq(driveEntries.parentEntryId, target), eq(driveEntries.status, "normal")))
    .all();

  const entries: PublicShareEntry[] = rows
    .map(r => ({
      id: r.id,
      name: r.name,
      type: r.entryType,
      size: r.size,
      mimetype: r.mimetype,
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));

  return { breadcrumb, entries };
}

/**
 * Download one file from inside a public folder share. The file must be a
 * descendant of the shared folder; the share's download budget is shared
 * across all files in the folder.
 */
export async function accessPublicShareFile(
  db: AppDatabase,
  token: string,
  password: string | undefined,
  entryId: string,
): Promise<{ readonly file: FileRow; readonly reference: FileReferenceRow }> {
  const row = await gatePublicShare(db, token, password);
  if (row.entryType !== "folder")
    throw new AppError("Share is not a folder", 400, "INVALID_ENTRY_TYPE");
  if (row.share.permission === "view")
    throw new ForbiddenError("This link is view-only");

  const entry = await db.select().from(driveEntries).where(eq(driveEntries.id, entryId)).get();
  if (!entry || entry.status !== "normal" || entry.entryType !== "file" || !entry.fileReferenceId)
    throw new NotFoundError("Shared file", entryId);

  // The requested file must live inside the shared folder subtree.
  const path = await resolveSubtreePath(db, entry.parentEntryId, row.share.driveEntryId, row.entryName);
  if (!path)
    throw new NotFoundError("Shared file", entryId);

  const reserved = db.transaction((tx) => {
    const current = tx
      .select({ downloadCount: driveFileShares.downloadCount, maxDownloads: driveFileShares.maxDownloads, isActive: driveFileShares.isActive })
      .from(driveFileShares)
      .where(eq(driveFileShares.id, row.share.id))
      .get();
    if (!current || current.isActive !== 1)
      return false;
    if (current.maxDownloads !== null && current.downloadCount >= current.maxDownloads)
      return false;
    tx.update(driveFileShares).set({ downloadCount: current.downloadCount + 1 }).where(eq(driveFileShares.id, row.share.id)).run();
    return true;
  });
  if (!reserved)
    throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");

  const ref = await db.select().from(fileReferences).where(eq(fileReferences.id, entry.fileReferenceId)).get();
  if (!ref)
    throw new NotFoundError("Shared file", entryId);
  const file = await db.select().from(files).where(eq(files.id, ref.fileId)).get();
  if (!file)
    throw new NotFoundError("Shared file", entryId);

  return { file, reference: ref };
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function queryShareViews(db: AppDatabase, where: SQL): Promise<readonly DriveShareView[]> {
  const rows = await db
    .select({
      share: driveFileShares,
      entryName: driveEntries.name,
      entryType: driveEntries.entryType,
      filename: fileReferences.filename,
      mimetype: files.mimetype,
      size: files.size,
    })
    .from(driveFileShares)
    .innerJoin(driveEntries, eq(driveFileShares.driveEntryId, driveEntries.id))
    .leftJoin(fileReferences, eq(driveEntries.fileReferenceId, fileReferences.id))
    .leftJoin(files, eq(fileReferences.fileId, files.id))
    .where(where)
    .orderBy(desc(driveFileShares.createdAt), desc(driveFileShares.id))
    .all();
  return rows.map(composeShareView);
}

async function requireShareView(db: AppDatabase, shareId: string): Promise<DriveShareView> {
  const rows = await queryShareViews(db, eq(driveFileShares.id, shareId));
  const view = rows[0];
  if (!view)
    throw new NotFoundError("File share", shareId);
  return view;
}

async function requireOwnedShare(db: AppDatabase, shareId: string, userId: string): Promise<DriveShareRow> {
  const share = await db.select().from(driveFileShares).where(eq(driveFileShares.id, shareId)).get();
  if (!share)
    throw new NotFoundError("File share", shareId);
  if (share.createdBy !== userId)
    throw new ForbiddenError("You do not own this share");
  return share;
}

function composeShareView(row: ShareJoinRow): DriveShareView {
  return {
    id: row.share.id,
    driveEntryId: row.share.driveEntryId,
    entryName: row.entryName,
    token: row.share.token,
    shareType: row.share.shareType,
    sharedWithUserId: row.share.sharedWithUserId,
    permission: row.share.permission,
    hasPassword: row.share.password !== null,
    expiresAt: row.share.expiresAt,
    maxDownloads: row.share.maxDownloads,
    downloadCount: row.share.downloadCount,
    isActive: row.share.isActive === 1,
    createdBy: row.share.createdBy,
    createdAt: row.share.createdAt,
    updatedAt: row.share.updatedAt,
    file: row.filename && row.mimetype && row.size !== null
      ? { filename: row.filename, mimetype: row.mimetype, size: row.size }
      : null,
  };
}
