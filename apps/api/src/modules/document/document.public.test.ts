import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { ulid } from "@/shared/lib/id";
import { errorHandler } from "@/shared/middleware/error-handler";
import { documentPublicRoutes } from "./document.public.routes";
import { documentRoutes } from "./document.routes";
import {
  addDocumentShare,
  createDocument,
  resolveDocumentItem,
  softDeleteDocument,
} from "./document.service";
import {
  createPublicLink,
  getPublicLinkByToken,
  updatePublicLink,
} from "./document.share.service";
import "@/modules/account";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string, role: "user" | "admin" = "user"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

function baseConfig(): Config {
  return {
    NODE_ENV: "test",
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_LOCAL_ROOT: "data/uploads/files",
    FILE_GC_MODE: "async",
    FILE_PRESIGN_ENABLED: false,
  } as unknown as Config;
}

/** Public (unauthenticated) app — mirrors how routes/public.ts mounts it. */
function buildPublicApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", noopLogger);
    await next();
  });
  app.route("/", documentPublicRoutes());
  app.onError(errorHandler);
  return app;
}

/** Authenticated app for owner-only management endpoints. */
function buildManageApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", noopLogger);
    await next();
  });
  app.route("/", documentRoutes());
  app.onError(errorHandler);
  return app;
}

async function sessionCookieFor(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "test-access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function policyCtx(actorId: string) {
  return { db, logger: noopLogger, actor: { id: actorId, type: "user" } };
}

/** Internal item id for a document short_id. */
async function itemIdOf(shortId: string): Promise<string> {
  const item = await resolveDocumentItem(db, shortId);
  return item!.id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-doc-public-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

const XHR = { "x-requested-with": "XMLHttpRequest", "content-type": "application/json" };

describe("public document view by token", () => {
  test("GET gate returns title + hasPassword, never the hash", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Public Doc", content: "hello", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    const app = buildPublicApp();

    const res = await app.request(`/documents/shared/${link.token}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.title).toBe("Public Doc");
    expect(body.data.hasPassword).toBe(false);
    expect(body.data.password).toBeUndefined();
  });

  test("POST returns document content for a password-less link", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", content: "the body", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    const app = buildPublicApp();

    const res = await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { document: { content: string; id: string } } };
    expect(body.data.document.content).toBe("the body");
    expect(body.data.document.id).toBe(doc.id);
  });

  test("password required + verified", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", content: "secret body", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice, password: "pw" });
    const app = buildPublicApp();

    const missing = await app.request(`/documents/shared/${link.token}`, { method: "POST", headers: XHR, body: JSON.stringify({}) });
    expect(missing.status).toBe(403);

    const wrong = await app.request(`/documents/shared/${link.token}`, { method: "POST", headers: XHR, body: JSON.stringify({ password: "nope" }) });
    expect(wrong.status).toBe(403);

    const ok = await app.request(`/documents/shared/${link.token}`, { method: "POST", headers: XHR, body: JSON.stringify({ password: "pw" }) });
    expect(ok.status).toBe(200);
  });

  test("expired link -> 404 on GET and POST", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const link = await createPublicLink(db, {
      documentId: await itemIdOf(doc.id),
      createdBy: alice,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const app = buildPublicApp();

    expect((await app.request(`/documents/shared/${link.token}`)).status).toBe(404);
    expect((await app.request(`/documents/shared/${link.token}`, { method: "POST", headers: XHR, body: "{}" })).status).toBe(404);
  });

  test("inactive (revoked) link -> 404", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    await updatePublicLink(db, link.id, alice, { isActive: false });
    const app = buildPublicApp();

    expect((await app.request(`/documents/shared/${link.token}`)).status).toBe(404);
  });

  test("unknown token -> 404", async () => {
    const app = buildPublicApp();
    expect((await app.request(`/documents/shared/does-not-exist`)).status).toBe(404);
  });

  test("soft-deleted document -> 404 even with an active link", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    await softDeleteDocument(db, doc.id);
    const app = buildPublicApp();

    expect((await app.request(`/documents/shared/${link.token}`)).status).toBe(404);
    expect((await app.request(`/documents/shared/${link.token}`, { method: "POST", headers: XHR, body: "{}" })).status).toBe(404);
  });
});

describe("subtree recursion via public link", () => {
  test("link on folder F reaches descendant doc C via docId; password enforced", async () => {
    const alice = await seedUser("Alice");
    const f = await createDocument(db, { title: "F", creatorId: alice });
    const child = await createDocument(db, { title: "Child", content: "child body", creatorId: alice, parentId: f.id });
    const grand = await createDocument(db, { title: "Grand", content: "grand body", creatorId: alice, parentId: child.id });
    const link = await createPublicLink(db, { documentId: await itemIdOf(f.id), createdBy: alice, password: "pw" });
    const app = buildPublicApp();

    // Wrong password fails for descendants too.
    const denied = await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({ docId: grand.id, password: "wrong" }),
    });
    expect(denied.status).toBe(403);

    const res = await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({ docId: grand.id, password: "pw" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { document: { content: string }; subtree: Array<{ id: string }> } };
    expect(body.data.document.content).toBe("grand body");
    const subtreeIds = body.data.subtree.map(n => n.id).sort();
    expect(subtreeIds).toEqual([f.id, child.id, grand.id].sort());
  });

  test("a document outside the link's subtree -> 404", async () => {
    const alice = await seedUser("Alice");
    const f = await createDocument(db, { title: "F", creatorId: alice });
    const outside = await createDocument(db, { title: "Outside", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(f.id), createdBy: alice });
    const app = buildPublicApp();

    const res = await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({ docId: outside.id }),
    });
    expect(res.status).toBe(404);
  });

  test("revoking the link kills access to the whole subtree", async () => {
    const alice = await seedUser("Alice");
    const f = await createDocument(db, { title: "F", creatorId: alice });
    const child = await createDocument(db, { title: "Child", content: "c", creatorId: alice, parentId: f.id });
    const link = await createPublicLink(db, { documentId: await itemIdOf(f.id), createdBy: alice });
    const app = buildPublicApp();

    expect((await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({ docId: child.id }),
    })).status).toBe(200);

    await updatePublicLink(db, link.id, alice, { isActive: false });

    expect((await app.request(`/documents/shared/${link.token}`, {
      method: "POST",
      headers: XHR,
      body: JSON.stringify({ docId: child.id }),
    })).status).toBe(404);
  });
});

describe("public attachment access guards", () => {
  test("unknown attachment id -> 404", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    const app = buildPublicApp();

    const res = await app.request(`/documents/shared/${link.token}/attachments/nope`, {
      method: "POST",
      headers: XHR,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("attachment owned by a document outside the subtree -> 404 (IDOR guard)", async () => {
    const alice = await seedUser("Alice");
    const f = await createDocument(db, { title: "F", creatorId: alice });
    const outside = await createDocument(db, { title: "Outside", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(f.id), createdBy: alice });

    // Seed a file + reference owned by the out-of-subtree document.
    const fileId = ulid();
    const refId = ulid();
    await db.insert(files).values({
      id: fileId,
      sha256: "x".repeat(64),
      size: 3,
      mimetype: "text/plain",
      storageDriver: "local",
      storageKey: "k",
      refCount: 1,
      uploadedBy: alice,
    }).run();
    await db.insert(fileReferences).values({
      id: refId,
      fileId,
      ownerType: "item_attachment",
      ownerId: await itemIdOf(outside.id),
      filename: "secret.txt",
      createdBy: alice,
    }).run();

    const app = buildPublicApp();
    const res = await app.request(`/documents/shared/${link.token}/attachments/${refId}`, {
      method: "POST",
      headers: XHR,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("owner-only public-link management", () => {
  test("owner can create, list, update, revoke", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const app = buildManageApp();
    const cookie = await sessionCookieFor(alice);

    const created = await app.request(`/documents/${doc.id}/public-links`, {
      method: "POST",
      headers: { ...XHR, cookie },
      body: JSON.stringify({ password: "pw" }),
    });
    expect(created.status).toBe(201);
    const link = (await created.json() as { data: { id: string; token: string; hasPassword: boolean } }).data;
    expect(link.hasPassword).toBe(true);

    const listed = await app.request(`/documents/${doc.id}/public-links`, { headers: { cookie } });
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: unknown[] }).data).toHaveLength(1);

    const patched = await app.request(`/documents/${doc.id}/public-links/${link.id}`, {
      method: "PATCH",
      headers: { ...XHR, cookie },
      body: JSON.stringify({ isActive: false }),
    });
    expect(patched.status).toBe(200);

    const revoked = await app.request(`/documents/${doc.id}/public-links/${link.id}`, {
      method: "DELETE",
      headers: { ...XHR, cookie },
    });
    expect(revoked.status).toBe(200);
    const row = await getPublicLinkByToken(db, link.token);
    expect(row?.isActive).toBe(0);
  });

  test("non-owner cannot create / list / update / revoke (403)", async () => {
    const alice = await seedUser("Alice");
    const mallory = await seedUser("Mallory");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    const link = await createPublicLink(db, { documentId: await itemIdOf(doc.id), createdBy: alice });
    const app = buildManageApp();
    const cookie = await sessionCookieFor(mallory);

    expect((await app.request(`/documents/${doc.id}/public-links`, { headers: { cookie } })).status).toBe(403);
    expect((await app.request(`/documents/${doc.id}/public-links`, {
      method: "POST",
      headers: { ...XHR, cookie },
      body: "{}",
    })).status).toBe(403);
    expect((await app.request(`/documents/${doc.id}/public-links/${link.id}`, {
      method: "PATCH",
      headers: { ...XHR, cookie },
      body: JSON.stringify({ isActive: false }),
    })).status).toBe(403);
    expect((await app.request(`/documents/${doc.id}/public-links/${link.id}`, {
      method: "DELETE",
      headers: { ...XHR, cookie },
    })).status).toBe(403);
  });

  test("shared viewer (non-owner) cannot manage links (403)", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    await addDocumentShare(policyCtx(alice), { documentId: doc.id, targetType: "user", targetId: bob, permission: "viewer" });
    const app = buildManageApp();

    const res = await app.request(`/documents/${doc.id}/public-links`, {
      method: "POST",
      headers: { ...XHR, cookie: await sessionCookieFor(bob) },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  test("cannot mint a public link for a soft-deleted document (404)", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });
    await softDeleteDocument(db, doc.id);
    const app = buildManageApp();

    const res = await app.request(`/documents/${doc.id}/public-links`, {
      method: "POST",
      headers: { ...XHR, cookie: await sessionCookieFor(alice) },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
