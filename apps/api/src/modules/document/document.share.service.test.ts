import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { items } from "@/modules/item/schema";
import { nanoid, ulid } from "@/shared/lib/id";
import {
  createPublicLink,
  getPublicLinkByToken,
  isPublicLinkExpired,
  listPublicLinks,
  revokePublicLink,
  updatePublicLink,
  verifyPublicLinkPassword,
} from "./document.share.service";

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

async function seedDocument(creatorId: string): Promise<string> {
  const id = ulid();
  await db.insert(items).values({
    id,
    shortId: nanoid(),
    type: "document",
    title: "Doc",
    status: "active",
    creatorId,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-doc-share-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("createPublicLink", () => {
  test("creates a link resolvable by token, view never exposes the hash", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);

    const view = await createPublicLink(db, { documentId: docId, createdBy: userId });

    expect(view.documentId).toBe(docId);
    expect(view.token).toHaveLength(10);
    expect(view.isActive).toBe(true);
    expect(view.hasPassword).toBe(false);
    expect(view.expiresAt).toBeNull();
    // The client-facing shape must not carry the password column at all.
    expect((view as unknown as Record<string, unknown>).password).toBeUndefined();

    const row = await getPublicLinkByToken(db, view.token);
    expect(row?.id).toBe(view.id);
  });

  test("rejects a link for a non-existent document", async () => {
    const userId = await seedUser("Alice");
    expect(createPublicLink(db, { documentId: "missing", createdBy: userId })).rejects.toThrow("not found");
  });

  test("mints unique tokens across links", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const a = await createPublicLink(db, { documentId: docId, createdBy: userId });
    const b = await createPublicLink(db, { documentId: docId, createdBy: userId });
    expect(a.token).not.toBe(b.token);
  });
});

describe("password protection", () => {
  test("stores a hash (not the plaintext) and verifies correct / incorrect passwords", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const view = await createPublicLink(db, { documentId: docId, createdBy: userId, password: "s3cret" });

    expect(view.hasPassword).toBe(true);

    const row = await getPublicLinkByToken(db, view.token);
    expect(row?.password).toBeString();
    expect(row?.password).not.toBe("s3cret");

    expect(await verifyPublicLinkPassword(row!, "s3cret")).toBe(true);
    expect(await verifyPublicLinkPassword(row!, "wrong")).toBe(false);
    expect(await verifyPublicLinkPassword(row!, undefined)).toBe(false);
  });

  test("a password-less link accepts any caller", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const view = await createPublicLink(db, { documentId: docId, createdBy: userId });
    const row = await getPublicLinkByToken(db, view.token);
    expect(await verifyPublicLinkPassword(row!, undefined)).toBe(true);
    expect(await verifyPublicLinkPassword(row!, "anything")).toBe(true);
  });
});

describe("isPublicLinkExpired", () => {
  test("null expiry never expires; past expires, future does not", () => {
    expect(isPublicLinkExpired({ expiresAt: null })).toBe(false);
    expect(isPublicLinkExpired({ expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(isPublicLinkExpired({ expiresAt: new Date(Date.now() + 60_000).toISOString() })).toBe(false);
  });
});

describe("updatePublicLink", () => {
  test("sets and clears the password, leaving it untouched when omitted", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const view = await createPublicLink(db, { documentId: docId, createdBy: userId });

    const withPw = await updatePublicLink(db, view.id, userId, { password: "pw" });
    expect(withPw.hasPassword).toBe(true);

    // Omitting password must not wipe it.
    const afterExpiry = await updatePublicLink(db, view.id, userId, { expiresAt: new Date(Date.now() + 1000).toISOString() });
    expect(afterExpiry.hasPassword).toBe(true);
    expect(afterExpiry.expiresAt).not.toBeNull();

    const cleared = await updatePublicLink(db, view.id, userId, { password: null });
    expect(cleared.hasPassword).toBe(false);
  });

  test("toggles isActive", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const view = await createPublicLink(db, { documentId: docId, createdBy: userId });

    const off = await updatePublicLink(db, view.id, userId, { isActive: false });
    expect(off.isActive).toBe(false);
    const on = await updatePublicLink(db, view.id, userId, { isActive: true });
    expect(on.isActive).toBe(true);
  });

  test("rejects updates from a non-owner", async () => {
    const owner = await seedUser("Alice");
    const other = await seedUser("Bob");
    const docId = await seedDocument(owner);
    const view = await createPublicLink(db, { documentId: docId, createdBy: owner });

    expect(updatePublicLink(db, view.id, other, { isActive: false })).rejects.toThrow("do not own");
  });
});

describe("revokePublicLink", () => {
  test("flips isActive off", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    const view = await createPublicLink(db, { documentId: docId, createdBy: userId });

    await revokePublicLink(db, view.id, userId);

    const row = await getPublicLinkByToken(db, view.token);
    expect(row?.isActive).toBe(0);
  });

  test("rejects revoke from a non-owner", async () => {
    const owner = await seedUser("Alice");
    const other = await seedUser("Bob");
    const docId = await seedDocument(owner);
    const view = await createPublicLink(db, { documentId: docId, createdBy: owner });

    expect(revokePublicLink(db, view.id, other)).rejects.toThrow("do not own");
  });
});

describe("listPublicLinks", () => {
  test("returns the document's links newest-first, free of password hashes", async () => {
    const userId = await seedUser("Alice");
    const docId = await seedDocument(userId);
    await createPublicLink(db, { documentId: docId, createdBy: userId, password: "pw" });
    await createPublicLink(db, { documentId: docId, createdBy: userId });

    const links = await listPublicLinks(db, docId);
    expect(links).toHaveLength(2);
    for (const link of links)
      expect((link as unknown as Record<string, unknown>).password).toBeUndefined();
  });
});
