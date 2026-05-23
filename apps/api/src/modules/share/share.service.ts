import type { SQL } from "drizzle-orm";
import type { ShareGateRow } from "./adapter";
import type { SharePermission, ShareResourceType, ShareType } from "./schema";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { findShareAdapter } from "./adapter";
import { shares } from "./schema";

export type ShareRow = typeof shares.$inferSelect;

/** Client-facing share shape — exposes `hasPassword`, never the hash. */
export interface ShareView {
  readonly id: string;
  readonly resourceType: ShareResourceType;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly isFolder: boolean;
  readonly token: string;
  readonly shareType: ShareType;
  readonly sharedWithUserId: string | null;
  readonly permission: SharePermission;
  readonly hasPassword: boolean;
  readonly expiresAt: string | null;
  readonly maxDownloads: number | null;
  readonly downloadCount: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: { readonly filename: string; readonly mimetype: string; readonly size: number } | null;
}

/** Public-facing share metadata — never leaks bytes or the password hash. */
export interface PublicShareMeta {
  readonly token: string;
  readonly resourceType: ShareResourceType;
  readonly name: string;
  readonly isFolder: boolean;
  readonly permission: SharePermission;
  readonly requiresPassword: boolean;
  readonly expired: boolean;
  readonly exhausted: boolean;
}

function requireAdapter(resourceType: ShareResourceType) {
  const adapter = findShareAdapter(resourceType);
  if (!adapter)
    throw new AppError(`No share adapter for resource type '${resourceType}'`, 400, "INVALID_RESOURCE_TYPE");
  return adapter;
}

/** Short url-safe token — `nanoid(10)`, unguessable and unique per share. */
function generateShareToken(): string {
  return nanoid(10);
}

function isExpired(share: Pick<ShareRow, "expiresAt">): boolean {
  return share.expiresAt !== null && new Date(share.expiresAt).getTime() < Date.now();
}

function isExhausted(share: Pick<ShareRow, "maxDownloads" | "downloadCount">): boolean {
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads;
}

function toGateRow(row: ShareRow): ShareGateRow {
  return { id: row.id, resourceType: row.resourceType, resourceId: row.resourceId, permission: row.permission };
}

async function composeShareView(db: AppDatabase, row: ShareRow): Promise<ShareView> {
  const adapter = requireAdapter(row.resourceType);
  const resolved = await adapter.resolve(db, row.resourceId);
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: resolved?.name ?? row.resourceId,
    isFolder: resolved?.isFolder ?? false,
    token: row.token,
    shareType: row.shareType,
    sharedWithUserId: row.sharedWithUserId,
    permission: row.permission,
    hasPassword: row.password !== null,
    expiresAt: row.expiresAt,
    maxDownloads: row.maxDownloads,
    downloadCount: row.downloadCount,
    isActive: row.isActive === 1,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    file: resolved?.file ?? null,
  };
}

async function queryShareViews(db: AppDatabase, where: SQL): Promise<readonly ShareView[]> {
  const rows = await db
    .select()
    .from(shares)
    .where(where)
    .orderBy(desc(shares.createdAt), desc(shares.id))
    .all();
  return Promise.all(rows.map(r => composeShareView(db, r)));
}

async function requireShareView(db: AppDatabase, shareId: string): Promise<ShareView> {
  const row = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!row)
    throw new NotFoundError("Share", shareId);
  return composeShareView(db, row);
}

async function requireOwnedShare(db: AppDatabase, shareId: string, userId: string): Promise<ShareRow> {
  const share = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share)
    throw new NotFoundError("Share", shareId);
  if (share.createdBy !== userId)
    throw new ForbiddenError("You do not own this share");
  return share;
}

/** Whether an active share of the given kind already exists for a resource. */
async function hasActiveShare(
  db: AppDatabase,
  resourceType: ShareResourceType,
  resourceId: string,
  shareType: ShareType,
  sharedWithUserId?: string,
): Promise<boolean> {
  const row = await db
    .select({ id: shares.id })
    .from(shares)
    .where(and(
      eq(shares.resourceType, resourceType),
      eq(shares.resourceId, resourceId),
      eq(shares.shareType, shareType),
      eq(shares.isActive, 1),
      ...(sharedWithUserId ? [eq(shares.sharedWithUserId, sharedWithUserId)] : []),
    )!)
    .get();
  return row !== undefined;
}

export interface CreateShareInput {
  readonly resourceType: ShareResourceType;
  readonly resourceId: string;
  readonly createdBy: string;
  readonly shareType: ShareType;
  readonly permission: SharePermission;
  readonly sharedWithUserId?: string | undefined;
  readonly password?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly maxDownloads?: number | null | undefined;
}

export async function createShare(db: AppDatabase, input: CreateShareInput): Promise<ShareView> {
  const adapter = requireAdapter(input.resourceType);
  const resolved = await adapter.resolve(db, input.resourceId);
  if (!resolved)
    throw new NotFoundError("Shared resource", input.resourceId);

  if (!adapter.capabilities.shareTypes.includes(input.shareType))
    throw new AppError(`'${input.resourceType}' does not support '${input.shareType}' shares`, 400, "VALIDATION_ERROR");
  if (!adapter.capabilities.permissions.includes(input.permission))
    throw new AppError(`'${input.resourceType}' does not support '${input.permission}' permission`, 400, "VALIDATION_ERROR");

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
      throw new AppError("Cannot share a resource with yourself", 400, "VALIDATION_ERROR");
    // One active direct share per (resource, recipient) — no duplicate grants.
    if (await hasActiveShare(db, input.resourceType, input.resourceId, "direct", input.sharedWithUserId))
      throw new AppError("This resource is already shared with that user", 409, "SHARE_EXISTS");
    sharedWithUserId = input.sharedWithUserId;
  }
  else {
    // public_link — at most one active link per resource.
    if (await hasActiveShare(db, input.resourceType, input.resourceId, "public_link"))
      throw new AppError("A public link already exists for this resource", 409, "SHARE_EXISTS");
    if (input.password)
      password = await Bun.password.hash(input.password);
    expiresAt = input.expiresAt ?? null;
    maxDownloads = input.maxDownloads ?? null;
  }

  const id = nanoid();
  await db.insert(shares).values({
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
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

/** All active shares for a resource, newest first. */
export async function listSharesForResource(
  db: AppDatabase,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<readonly ShareView[]> {
  return queryShareViews(db, and(
    eq(shares.resourceType, resourceType),
    eq(shares.resourceId, resourceId),
    eq(shares.isActive, 1),
  )!);
}

/** Active direct shares where the caller is the recipient. */
export async function listReceivedShares(db: AppDatabase, userId: string): Promise<readonly ShareView[]> {
  return queryShareViews(db, and(
    eq(shares.sharedWithUserId, userId),
    eq(shares.shareType, "direct"),
    eq(shares.isActive, 1),
  )!);
}

/** Active direct shares created by the caller. */
export async function listSentShares(db: AppDatabase, userId: string): Promise<readonly ShareView[]> {
  return queryShareViews(db, and(
    eq(shares.createdBy, userId),
    eq(shares.shareType, "direct"),
    eq(shares.isActive, 1),
  )!);
}

/** Active public-link shares created by the caller. */
export async function listLinkShares(db: AppDatabase, userId: string): Promise<readonly ShareView[]> {
  return queryShareViews(db, and(
    eq(shares.createdBy, userId),
    eq(shares.shareType, "public_link"),
    eq(shares.isActive, 1),
  )!);
}

export interface UpdateShareInput {
  readonly permission?: SharePermission | undefined;
  /** `undefined` keeps the current password, `null` clears it, a string sets a new one. */
  readonly password?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly maxDownloads?: number | null | undefined;
  readonly isActive?: boolean | undefined;
}

export async function updateShare(db: AppDatabase, shareId: string, userId: string, input: UpdateShareInput): Promise<ShareView> {
  const share = await requireOwnedShare(db, shareId, userId);

  const patch: Partial<typeof shares.$inferInsert> = { updatedAt: new Date().toISOString() };
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

  await db.update(shares).set(patch).where(eq(shares.id, shareId)).run();
  return requireShareView(db, shareId);
}

/** Soft-revoke: flip `isActive` off so the token stops resolving. */
export async function revokeShare(db: AppDatabase, shareId: string, userId: string): Promise<void> {
  await requireOwnedShare(db, shareId, userId);
  await db.update(shares)
    .set({ isActive: 0, updatedAt: new Date().toISOString() })
    .where(eq(shares.id, shareId))
    .run();
}

/** Cascade cleanup — delete every share for a resource. Called from the owning module's delete path. */
export async function deleteSharesForResource(
  db: AppDatabase,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<void> {
  await db.delete(shares)
    .where(and(eq(shares.resourceType, resourceType), eq(shares.resourceId, resourceId)))
    .run();
}

// ─── Public access ──────────────────────────────────────────────────────

async function getActivePublicShare(db: AppDatabase, token: string): Promise<ShareRow | undefined> {
  const row = await db.select().from(shares).where(eq(shares.token, token)).get();
  if (!row || row.shareType !== "public_link" || row.isActive !== 1)
    return undefined;
  return row;
}

/** Public GET — metadata only, no bytes, no password hash. */
export async function getPublicShareMeta(db: AppDatabase, token: string): Promise<PublicShareMeta> {
  const share = await getActivePublicShare(db, token);
  if (!share)
    throw new NotFoundError("Share link", token);
  const resolved = await requireAdapter(share.resourceType).resolve(db, share.resourceId);
  if (!resolved)
    throw new NotFoundError("Share link", token);
  return {
    token: share.token,
    resourceType: share.resourceType,
    name: resolved.name,
    isFolder: resolved.isFolder,
    permission: share.permission,
    requiresPassword: share.password !== null,
    expired: isExpired(share),
    exhausted: isExhausted(share),
  };
}

/**
 * Resolve + gate an active public-link share (password / expiry / exhaustion),
 * returning the share row for resource content routes. Unknown / inactive /
 * expired tokens throw the same errors regardless of resource type.
 */
export async function gatePublicShare(db: AppDatabase, token: string, password: string | undefined): Promise<ShareRow> {
  const share = await getActivePublicShare(db, token);
  if (!share)
    throw new NotFoundError("Share link", token);
  if (isExpired(share))
    throw new AppError("Share link has expired", 410, "SHARE_EXPIRED");
  if (isExhausted(share))
    throw new AppError("Share download limit reached", 410, "SHARE_EXHAUSTED");
  if (share.password !== null) {
    if (!password)
      throw new ForbiddenError("Password required");
    if (!(await Bun.password.verify(password, share.password)))
      throw new ForbiddenError("Invalid password");
  }
  return share;
}

/**
 * Atomic, race-safe download-budget reservation. A `null` budget always
 * succeeds without mutation. Concurrent callers can never push
 * `downloadCount` past `maxDownloads`.
 */
export function reserveDownload(db: AppDatabase, shareId: string): boolean {
  return db.transaction((tx) => {
    const current = tx
      .select({ downloadCount: shares.downloadCount, maxDownloads: shares.maxDownloads, isActive: shares.isActive })
      .from(shares)
      .where(eq(shares.id, shareId))
      .get();
    if (!current || current.isActive !== 1)
      return false;
    if (current.maxDownloads === null)
      return true;
    if (current.downloadCount >= current.maxDownloads)
      return false;
    tx.update(shares).set({ downloadCount: current.downloadCount + 1 }).where(eq(shares.id, shareId)).run();
    return true;
  });
}

export { toGateRow };
