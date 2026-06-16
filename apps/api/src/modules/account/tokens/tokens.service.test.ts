import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { testNanoid } from "@/shared/test/route-harness";
import { apiTokens } from "./schema";
import {
  createToken,
  findActiveByHash,
  generateTokenSecret,
  getTokenByIdForUser,
  hashToken,
  listTokensForUser,
  revokeToken,
  touchLastUsed,
} from "./tokens.service";

let db: AppDatabase;
let dbPath: string;
let userId: string;

async function seedUser(): Promise<string> {
  const id = testNanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-tokens-svc-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  userId = await seedUser();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("token secret generation", () => {
  test("secrets are prefixed, unique, and hash deterministically", () => {
    const a = generateTokenSecret();
    const b = generateTokenSecret();
    expect(a.startsWith("bithk_pat_")).toBe(true);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});

describe("createToken", () => {
  test("stores a hash (not the plaintext), a display prefix, and an expiry", async () => {
    const { token, row } = await createToken(db, {
      userId,
      name: "ci",
      scopes: { projects: "write" },
      expiresInDays: 30,
    });
    expect(token.startsWith("bithk_pat_")).toBe(true);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(token.startsWith(row.prefix)).toBe(true);
    expect(row.expiresAt > new Date().toISOString()).toBe(true);
    expect(JSON.parse(row.scopes)).toEqual({ projects: "write" });
  });
});

describe("findActiveByHash", () => {
  test("resolves a live token", async () => {
    const { token } = await createToken(db, { userId, name: "x", scopes: {}, expiresInDays: 30 });
    const found = await findActiveByHash(db, hashToken(token));
    expect(found?.userId).toBe(userId);
  });

  test("rejects a revoked token", async () => {
    const { token, row } = await createToken(db, { userId, name: "x", scopes: {}, expiresInDays: 30 });
    await revokeToken(db, row.id);
    expect(await findActiveByHash(db, hashToken(token))).toBeUndefined();
  });

  test("rejects an expired token", async () => {
    const { token, row } = await createToken(db, { userId, name: "x", scopes: {}, expiresInDays: 30 });
    // Force expiry into the past.
    await db.update(apiTokens).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(apiTokens.id, row.id)).run();
    expect(await findActiveByHash(db, hashToken(token))).toBeUndefined();
  });

  test("rejects an unknown hash", async () => {
    expect(await findActiveByHash(db, hashToken("bithk_pat_nope"))).toBeUndefined();
  });
});

describe("list / revoke / ownership", () => {
  test("listTokensForUser returns only the user's tokens, newest first", async () => {
    const other = await seedUser();
    await createToken(db, { userId, name: "a", scopes: {}, expiresInDays: 1 });
    await createToken(db, { userId, name: "b", scopes: {}, expiresInDays: 1 });
    await createToken(db, { userId: other, name: "c", scopes: {}, expiresInDays: 1 });
    const mine = await listTokensForUser(db, userId);
    expect(mine.length).toBe(2);
    expect(mine.every(t => t.userId === userId)).toBe(true);
  });

  test("getTokenByIdForUser scopes to the owner", async () => {
    const other = await seedUser();
    const { row } = await createToken(db, { userId, name: "a", scopes: {}, expiresInDays: 1 });
    expect(await getTokenByIdForUser(db, userId, row.id)).toBeTruthy();
    expect(await getTokenByIdForUser(db, other, row.id)).toBeUndefined();
  });

  test("revokeToken is idempotent and keeps the first revoke time", async () => {
    const { row } = await createToken(db, { userId, name: "a", scopes: {}, expiresInDays: 1 });
    await revokeToken(db, row.id);
    const first = (await db.select().from(apiTokens).where(eq(apiTokens.id, row.id)).get())!.revokedAt;
    expect(first).toBeTruthy();
  });

  test("touchLastUsed stamps lastUsedAt", async () => {
    const { row } = await createToken(db, { userId, name: "a", scopes: {}, expiresInDays: 1 });
    expect(row.lastUsedAt).toBeNull();
    await touchLastUsed(db, row.id);
    const after = (await db.select().from(apiTokens).where(eq(apiTokens.id, row.id)).get())!;
    expect(after.lastUsedAt).toBeTruthy();
  });
});
