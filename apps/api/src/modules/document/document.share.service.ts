import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { items } from "@/modules/item/schema";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { documentPublicLinks } from "./schema";

/** Raw row including the password hash — internal use only, never returned to API clients. */
export type DocumentPublicLinkRow = typeof documentPublicLinks.$inferSelect;

/** Client-facing public-link shape — exposes `hasPassword`, never the hash. */
export interface DocumentPublicLinkView {
  readonly id: string;
  readonly documentId: string;
  readonly token: string;
  readonly hasPassword: boolean;
  readonly expiresAt: string | null;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Short url-safe token — `nanoid(10)`, unguessable and unique per link. */
function generatePublicLinkToken(): string {
  return nanoid(10);
}

/** A public link is expired once its (optional) `expiresAt` is in the past. */
export function isPublicLinkExpired(link: Pick<DocumentPublicLinkRow, "expiresAt">): boolean {
  return link.expiresAt !== null && new Date(link.expiresAt).getTime() < Date.now();
}

function toView(row: DocumentPublicLinkRow): DocumentPublicLinkView {
  return {
    id: row.id,
    documentId: row.documentId,
    token: row.token,
    hasPassword: row.password !== null,
    expiresAt: row.expiresAt,
    isActive: row.isActive === 1,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertDocumentExists(db: AppDatabase, documentId: string): Promise<void> {
  const doc = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, documentId), eq(items.type, "document")))
    .get();
  if (!doc)
    throw new NotFoundError("Document", documentId);
}

async function requireOwnedLink(db: AppDatabase, linkId: string, userId: string): Promise<DocumentPublicLinkRow> {
  const link = await db.select().from(documentPublicLinks).where(eq(documentPublicLinks.id, linkId)).get();
  if (!link)
    throw new NotFoundError("Public link", linkId);
  if (link.createdBy !== userId)
    throw new ForbiddenError("You do not own this public link");
  return link;
}

async function requireView(db: AppDatabase, linkId: string): Promise<DocumentPublicLinkView> {
  const row = await db.select().from(documentPublicLinks).where(eq(documentPublicLinks.id, linkId)).get();
  if (!row)
    throw new NotFoundError("Public link", linkId);
  return toView(row);
}

export interface CreatePublicLinkInput {
  readonly documentId: string;
  readonly createdBy: string;
  readonly password?: string | undefined;
  readonly expiresAt?: string | null | undefined;
}

export async function createPublicLink(db: AppDatabase, input: CreatePublicLinkInput): Promise<DocumentPublicLinkView> {
  await assertDocumentExists(db, input.documentId);

  // A document carries at most one active public link. Revoke the existing
  // one before issuing a new token.
  const existing = await db
    .select({ id: documentPublicLinks.id })
    .from(documentPublicLinks)
    .where(and(eq(documentPublicLinks.documentId, input.documentId), eq(documentPublicLinks.isActive, 1)))
    .get();
  if (existing)
    throw new AppError("This document already has a public link", 409, "PUBLIC_LINK_EXISTS");

  const id = nanoid();
  await db.insert(documentPublicLinks).values({
    id,
    documentId: input.documentId,
    token: generatePublicLinkToken(),
    password: input.password ? await Bun.password.hash(input.password) : null,
    expiresAt: input.expiresAt ?? null,
    createdBy: input.createdBy,
  }).run();

  return requireView(db, id);
}

/** All public links for a document, newest first. Hash never leaks. */
export async function listPublicLinks(db: AppDatabase, documentId: string): Promise<readonly DocumentPublicLinkView[]> {
  const rows = await db
    .select()
    .from(documentPublicLinks)
    .where(eq(documentPublicLinks.documentId, documentId))
    .orderBy(desc(documentPublicLinks.createdAt), desc(documentPublicLinks.id))
    .all();
  return rows.map(toView);
}

export interface UpdatePublicLinkInput {
  /** `undefined` keeps the current password, `null` clears it, a string sets a new one. */
  readonly password?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export async function updatePublicLink(
  db: AppDatabase,
  linkId: string,
  userId: string,
  input: UpdatePublicLinkInput,
): Promise<DocumentPublicLinkView> {
  await requireOwnedLink(db, linkId, userId);

  const patch: Partial<typeof documentPublicLinks.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.expiresAt !== undefined)
    patch.expiresAt = input.expiresAt ?? null;
  if (input.isActive !== undefined)
    patch.isActive = input.isActive ? 1 : 0;
  if (input.password !== undefined)
    patch.password = input.password ? await Bun.password.hash(input.password) : null;

  await db.update(documentPublicLinks).set(patch).where(eq(documentPublicLinks.id, linkId)).run();
  return requireView(db, linkId);
}

/** Soft-revoke: flip `isActive` off so the token stops resolving. */
export async function revokePublicLink(db: AppDatabase, linkId: string, userId: string): Promise<void> {
  await requireOwnedLink(db, linkId, userId);
  await db.update(documentPublicLinks)
    .set({ isActive: 0, updatedAt: new Date().toISOString() })
    .where(eq(documentPublicLinks.id, linkId))
    .run();
}

/**
 * Internal lookup by token — returns the raw row INCLUDING the password
 * hash so callers can verify a password. Never feed this row directly into
 * an API response; map it through a view first. Returns `undefined` when no
 * link carries the token (callers decide how to treat inactive/expired).
 */
export async function getPublicLinkByToken(db: AppDatabase, token: string): Promise<DocumentPublicLinkRow | undefined> {
  return db.select().from(documentPublicLinks).where(eq(documentPublicLinks.token, token)).get();
}

/**
 * Verify a candidate password against a link's stored hash. A link without a
 * password accepts any caller (returns `true`). A protected link requires a
 * non-empty password that matches the argon2id hash.
 */
export async function verifyPublicLinkPassword(
  link: Pick<DocumentPublicLinkRow, "password">,
  password: string | undefined,
): Promise<boolean> {
  if (link.password === null)
    return true;
  if (!password)
    return false;
  return Bun.password.verify(password, link.password);
}
