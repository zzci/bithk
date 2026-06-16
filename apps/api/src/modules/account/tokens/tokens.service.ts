import type { TokenScopeMap } from "./scope";
import type { AppDatabase } from "@/db";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { apiTokens } from "./schema";
import { TOKEN_SECRET_PREFIX } from "./scope";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

/** plaintext kept for list display: `bithk_pat_` + 8 chars. */
const DISPLAY_PREFIX_LEN = TOKEN_SECRET_PREFIX.length + 8;

export const MAX_EXPIRY_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/** A fresh opaque secret. Shown to the caller once, never stored in clear. */
export function generateTokenSecret(): string {
  return TOKEN_SECRET_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function displayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LEN);
}

export interface CreateTokenInput {
  readonly userId: string;
  readonly name: string;
  readonly scopes: TokenScopeMap;
  readonly expiresInDays: number;
}

export interface CreatedToken {
  readonly token: string;
  readonly row: typeof apiTokens.$inferSelect;
}

export async function createToken(db: AppDatabase, input: CreateTokenInput): Promise<CreatedToken> {
  const token = generateTokenSecret();
  const id = nanoid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * MS_PER_DAY).toISOString();
  await db.insert(apiTokens).values({
    id,
    userId: input.userId,
    name: input.name,
    tokenHash: hashToken(token),
    prefix: displayPrefix(token),
    scopes: JSON.stringify(input.scopes),
    expiresAt,
    createdAt: now.toISOString(),
  }).run();
  const row = (await db.select().from(apiTokens).where(eq(apiTokens.id, id)).get())!;
  return { token, row };
}

export async function listTokensForUser(db: AppDatabase, userId: string) {
  return await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all();
}

export async function getTokenByIdForUser(db: AppDatabase, userId: string, tokenId: string) {
  return await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .get();
}

/** Soft-revoke (idempotent): stamps `revokedAt` if not already revoked. */
export async function revokeToken(db: AppDatabase, tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, tokenId))
    .run();
}

/** Resolve a presented secret to a live token row, or undefined if revoked/expired/missing. */
export async function findActiveByHash(db: AppDatabase, hash: string) {
  const row = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).get();
  if (!row || row.revokedAt)
    return undefined;
  if (row.expiresAt <= new Date().toISOString())
    return undefined;
  return row;
}

/** Best-effort last-used stamp; never blocks or throws into the request path. */
export async function touchLastUsed(db: AppDatabase, tokenId: string): Promise<void> {
  try {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiTokens.id, tokenId))
      .run();
  }
  catch {
    // ignore — touching last-used must not fail an otherwise-valid request
  }
}
