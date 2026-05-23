import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { groups } from "@/modules/account/groups/schema";
import { users } from "@/modules/account/users/schema";
import { items } from "@/modules/item/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createShare, listSharesForResource } from "@/modules/share/share.service";
import { errorHandler } from "@/shared/middleware/error-handler";
import { documentAccess } from "./document.permission";
import { documentRoutes } from "./document.routes";
import {
  addDocumentShare,
  createDocument,
  getDocumentById,
  getDocumentPermission,
  getDocumentShareById,
  getDocumentTreeForUser,
  invalidateTagCache,
  isVersionConflict,
  listAllGroups,
  listAllTags,
  listDescendantIds,
  listDocumentSharesWithInheritance,
  listMyDocuments,
  listSoftDeletedDescendants,
  moveDocument,
  pinDocument,
  removeDocumentShare,
  softDeleteDocument,
  unpinDocument,
  updateDocument,
} from "./document.service";
import "@/modules/account";
// Register the document share adapter so `createShare` can resolve documents.
import "./document.share-adapter";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string, role: "user" | "admin" = "user") {
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
    PORT: 3000,
    HOST: "127.0.0.1",
    DB_PATH: "data/db/app.db",
    APP_NAME: "app",
    APP_DISPLAY_NAME: "App",
    BASE_PATH: "",
    LOG_LEVEL: "info",
    LOG_FILE: "data/logs/app.log",
    LOG_TO_STDOUT: false,
    CORS_ORIGIN: undefined,
    TRUST_PROXY: false,
    TRUSTED_PROXY_IPS: "",
    CRON_ENABLED: false,
    CRON_ACTIONS_ENABLED: [],
    HTTP_ACTION_ALLOW_PRIVATE: false,
    HTTP_ACTION_TIMEOUT_SECONDS: 30,
    SHELL_ACTION_TIMEOUT_SECONDS: 300,
    OAUTH_CLIENT_ID: undefined,
    OAUTH_CLIENT_SECRET: undefined,
    OAUTH_ISSUER: undefined,
    OAUTH_AUTHORIZE_URL: undefined,
    OAUTH_TOKEN_URL: undefined,
    OAUTH_USERINFO_URL: undefined,
    OAUTH_PKCE: true,
    SESSION_MAX_AGE: 86400,
    AUDIT_RETENTION_DAYS: 0,
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_LOCAL_ROOT: "data/uploads/files",
    FILE_GC_MODE: "async",
    FILE_GC_INTERVAL_SECONDS: 3600,
    FILE_PRESIGN_ENABLED: true,
    FILE_PRESIGN_TTL_SECONDS: 300,
    DEFAULT_ADMIN: "",
    SINGLE_USER_MODE: false,
    SINGLE_USER_USERNAME: undefined,
    SINGLE_USER_PASSWORD_HASH: undefined,
    SINGLE_USER_PASSWORD_HASH_FILE: undefined,
    SINGLE_USER_NAME: undefined,
    SINGLE_USER_EMAIL: undefined,
    APP_URL: undefined,
    OIDC_LOGOUT_URL: undefined,
    SERVICE_TOKEN_METRICS: undefined,
    SERVICE_TOKEN_BACKUP: undefined,
    BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 0,
  } as unknown as Config;
}

function buildDocumentApp(): Hono<AppEnv> {
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

/** Build a policy context for service-level test calls. */
function policyCtx(actorId: string) {
  return { db, logger: noopLogger, actor: { id: actorId, type: "user" } };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-document-${Date.now()}-${nanoid()}`);
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

describe("createDocument", () => {
  test("creates with default fields and version 1", async () => {
    const userId = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Hi", creatorId: userId });
    expect(doc.id).toHaveLength(8);
    expect(doc.title).toBe("Hi");
    expect(doc.content).toBeNull();
    expect(doc.tags).toBe("[]");
    expect(doc.parentId).toBeNull();
    expect(doc.version).toBe(1);
    expect(doc.creatorId).toBe(userId);
  });

  test("nests via parentId; parent stored as short_id", async () => {
    const userId = await seedUser("Alice");
    const parent = await createDocument(db, { title: "P", creatorId: userId });
    const child = await createDocument(db, { title: "C", creatorId: userId, parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });
});

describe("documentRoutes create parent permissions", () => {
  test("rejects creating a child under a parent the actor cannot update", async () => {
    const owner = await seedUser("Owner");
    const actor = await seedUser("Mallory");
    const parent = await createDocument(db, { title: "Parent", creatorId: owner });
    const app = buildDocumentApp();

    const res = await app.request("/documents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": await sessionCookieFor(actor),
      },
      body: JSON.stringify({ title: "Injected", parentId: parent.id }),
    });

    expect(res.status).toBe(403);
  });

  test("allows creating a child under a parent the actor owns", async () => {
    const actor = await seedUser("Alice");
    const parent = await createDocument(db, { title: "Parent", creatorId: actor });
    const app = buildDocumentApp();

    const res = await app.request("/documents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": await sessionCookieFor(actor),
      },
      body: JSON.stringify({ title: "Child", parentId: parent.id }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { parentId: string } };
    expect(body.data.parentId).toBe(parent.id);
  });
});

describe("updateDocument (version + content + parent)", () => {
  test("bumps version on every successful update", async () => {
    const userId = await seedUser("Alice");
    const doc = await createDocument(db, { title: "v1", creatorId: userId });
    const updated = await updateDocument(db, doc.id, { content: "body" });
    expect(isVersionConflict(updated)).toBe(false);
    if (!isVersionConflict(updated))
      expect(updated!.version).toBeGreaterThan(1);
  });

  test("returns VersionConflict when expectedVersion mismatches", async () => {
    const userId = await seedUser("Alice");
    const doc = await createDocument(db, { title: "v1", creatorId: userId });
    await updateDocument(db, doc.id, { content: "v2" });
    const result = await updateDocument(db, doc.id, { content: "wrong", expectedVersion: 1 });
    expect(isVersionConflict(result)).toBe(true);
    if (isVersionConflict(result))
      expect(result.current.content).toBe("v2");
  });

  test("moves to a new parent; parent_item tuple rewritten in lockstep", async () => {
    const userId = await seedUser("Alice");
    const a = await createDocument(db, { title: "A", creatorId: userId });
    const b = await createDocument(db, { title: "B", creatorId: userId });
    const child = await createDocument(db, { title: "C", creatorId: userId, parentId: a.id });
    expect(child.parentId).toBe(a.id);
    const moved = await updateDocument(db, child.id, { parentId: b.id });
    if (isVersionConflict(moved))
      expect.unreachable("no conflict expected");
    else
      expect(moved?.parentId).toBe(b.id);
  });
});

describe("field-level write policy (commentsLocked → owner)", () => {
  test("owner can write commentsLocked", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    const item = (await db.select({ id: items.id })
      .from(items)
      .where(eq(items.shortId, doc.id))
      .get())!;
    const safe = await documentAccess.filterWritable(
      policyCtx(alice),
      item.id,
      { title: "new title", commentsLocked: true },
      { onForbidden: "reject" },
    );
    expect(safe).toEqual({ title: "new title", commentsLocked: true });
  });

  test("shared editor cannot write commentsLocked — strip mode drops it", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    await addDocumentShare(policyCtx(alice), {
      documentId: doc.id,
      targetType: "user",
      targetId: bob,
      permission: "editor",
    });
    const item = (await db.select({ id: items.id })
      .from(items)
      .where(eq(items.shortId, doc.id))
      .get())!;
    const safe = await documentAccess.filterWritable(
      policyCtx(bob),
      item.id,
      { title: "renamed by editor", commentsLocked: true },
      { onForbidden: "strip" },
    );
    expect(safe).toEqual({ title: "renamed by editor" });
  });

  test("shared editor cannot write commentsLocked — reject mode throws", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    await addDocumentShare(policyCtx(alice), {
      documentId: doc.id,
      targetType: "user",
      targetId: bob,
      permission: "editor",
    });
    const item = (await db.select({ id: items.id })
      .from(items)
      .where(eq(items.shortId, doc.id))
      .get())!;
    expect(
      documentAccess.filterWritable(
        policyCtx(bob),
        item.id,
        { commentsLocked: true },
        { onForbidden: "reject" },
      ),
    ).rejects.toThrow(/Cannot write field/);
  });
});

describe("softDeleteDocument", () => {
  test("soft-deletes the doc and every descendant; clears tuples", async () => {
    const userId = await seedUser("Alice");
    const root = await createDocument(db, { title: "Root", creatorId: userId });
    const child = await createDocument(db, { title: "Child", creatorId: userId, parentId: root.id });
    const grand = await createDocument(db, { title: "Grand", creatorId: userId, parentId: child.id });
    await softDeleteDocument(db, root.id);
    expect(await getDocumentById(db, root.id)).toBeUndefined();
    expect(await getDocumentById(db, child.id)).toBeUndefined();
    expect(await getDocumentById(db, grand.id)).toBeUndefined();
  });
});

describe("getDocumentPermission + subtree inheritance via policy", () => {
  test("creator has editor; uninvited user has nothing", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    expect(await getDocumentPermission(db, doc.id, alice)).toBe("editor");
    expect(await getDocumentPermission(db, doc.id, bob)).toBeNull();
  });

  test("explicit viewer share grants viewer", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    await addDocumentShare(policyCtx(alice), {
      documentId: doc.id,
      targetType: "user",
      targetId: bob,
      permission: "viewer",
    });
    expect(await getDocumentPermission(db, doc.id, bob)).toBe("viewer");
  });

  test("ancestor share inherits to descendants (parent_item)", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const parent = await createDocument(db, { title: "P", creatorId: alice });
    const child = await createDocument(db, { title: "C", creatorId: alice, parentId: parent.id });
    const grand = await createDocument(db, { title: "G", creatorId: alice, parentId: child.id });
    await addDocumentShare(policyCtx(alice), {
      documentId: parent.id,
      targetType: "user",
      targetId: bob,
      permission: "editor",
    });
    expect(await getDocumentPermission(db, parent.id, bob)).toBe("editor");
    expect(await getDocumentPermission(db, child.id, bob)).toBe("editor");
    expect(await getDocumentPermission(db, grand.id, bob)).toBe("editor");
  });

  test("removeDocumentShare drops the tuple — inherited access disappears", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const parent = await createDocument(db, { title: "P", creatorId: alice });
    const child = await createDocument(db, { title: "C", creatorId: alice, parentId: parent.id });
    const share = await addDocumentShare(policyCtx(alice), {
      documentId: parent.id,
      targetType: "user",
      targetId: bob,
      permission: "viewer",
    });
    expect(await getDocumentPermission(db, child.id, bob)).toBe("viewer");
    await removeDocumentShare(policyCtx(alice), share.id);
    expect(await getDocumentPermission(db, child.id, bob)).toBeNull();
  });
});

describe("listDocumentSharesWithInheritance", () => {
  test("returns self-shares with inheritedFrom=null + ancestor shares with inheritedFrom set", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const carol = await seedUser("Carol");
    const parent = await createDocument(db, { title: "Parent", creatorId: alice });
    const child = await createDocument(db, { title: "Child", creatorId: alice, parentId: parent.id });
    await addDocumentShare(policyCtx(alice), { documentId: parent.id, targetType: "user", targetId: bob, permission: "viewer" });
    await addDocumentShare(policyCtx(alice), { documentId: child.id, targetType: "user", targetId: carol, permission: "editor" });

    const list = await listDocumentSharesWithInheritance(db, child.id);
    const selfRow = list.find(r => r.targetId === carol);
    const inheritedRow = list.find(r => r.targetId === bob);
    expect(selfRow?.inheritedFrom).toBeNull();
    expect(inheritedRow?.inheritedFrom).toEqual({ id: parent.id, title: "Parent" });
  });
});

describe("listMyDocuments", () => {
  test("returns docs the user created", async () => {
    const me = await seedUser("Me");
    const other = await seedUser("Other");
    const mine = await createDocument(db, { title: "Mine", creatorId: me });
    await createDocument(db, { title: "Theirs", creatorId: other });
    const list = await listMyDocuments(db, { userId: me });
    expect(list.total).toBe(1);
    expect(list.data[0]!.id).toBe(mine.id);
  });

  test("returns docs shared with the user, plus descendants of shared docs", async () => {
    const owner = await seedUser("Owner");
    const me = await seedUser("Me");
    const parent = await createDocument(db, { title: "P", creatorId: owner });
    const child = await createDocument(db, { title: "C", creatorId: owner, parentId: parent.id });
    await addDocumentShare(policyCtx(owner), {
      documentId: parent.id,
      targetType: "user",
      targetId: me,
      permission: "viewer",
    });
    const list = await listMyDocuments(db, { userId: me });
    const ids = list.data.map(d => d.id).sort();
    expect(ids).toEqual([parent.id, child.id].sort());
  });
});

describe("getDocumentTreeForUser", () => {
  test("owner sees their own docs; child node reports parentId as short_id", async () => {
    const alice = await seedUser("Alice");
    const a = await createDocument(db, { title: "alpha", creatorId: alice });
    const b = await createDocument(db, { title: "Beta", creatorId: alice });
    const c = await createDocument(db, { title: "alpha-child", creatorId: alice, parentId: a.id });

    const tree = await getDocumentTreeForUser(db, { id: alice });
    const ids = tree.map(n => n.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(c.id);
    const childNode = tree.find(n => n.id === c.id);
    expect(childNode?.parentId).toBe(a.id);
  });

  test("only sees their own + their visible docs", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    await createDocument(db, { title: "alice doc", creatorId: alice });
    const bobDoc = await createDocument(db, { title: "bob doc", creatorId: bob });
    const tree = await getDocumentTreeForUser(db, { id: bob });
    expect(tree.map(n => n.id)).toEqual([bobDoc.id]);
  });

  test("admin gets no bypass: cannot see another admin's unshared doc in the tree", async () => {
    const adminA = await seedUser("AdminA", "admin");
    const adminB = await seedUser("AdminB", "admin");
    await createDocument(db, { title: "admin B doc", creatorId: adminB });
    const ownDoc = await createDocument(db, { title: "admin A doc", creatorId: adminA });

    const tree = await getDocumentTreeForUser(db, { id: adminA });
    expect(tree.map(n => n.id)).toEqual([ownDoc.id]);
  });
});

describe("document pins (per-user)", () => {
  test("pin marks the tree node for the pinning user only", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "Shared", creatorId: alice });
    await addDocumentShare(policyCtx(alice), {
      documentId: doc.id,
      targetType: "user",
      targetId: bob,
      permission: "viewer",
    });

    await pinDocument(db, alice, doc.id);

    const aliceTree = await getDocumentTreeForUser(db, { id: alice });
    expect(aliceTree.find(n => n.id === doc.id)?.pinned).toBe(true);

    // Bob sees the shared doc, but Alice's pin does not leak to him.
    const bobTree = await getDocumentTreeForUser(db, { id: bob });
    expect(bobTree.find(n => n.id === doc.id)?.pinned).toBe(false);
  });

  test("pin is idempotent and unpin clears it", async () => {
    const alice = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Doc", creatorId: alice });

    await pinDocument(db, alice, doc.id);
    await pinDocument(db, alice, doc.id); // no-op, no error
    expect((await getDocumentTreeForUser(db, { id: alice })).find(n => n.id === doc.id)?.pinned).toBe(true);

    await unpinDocument(db, alice, doc.id);
    await unpinDocument(db, alice, doc.id); // no-op, no error
    expect((await getDocumentTreeForUser(db, { id: alice })).find(n => n.id === doc.id)?.pinned).toBe(false);
  });

  test("returns false for an unknown document", async () => {
    const alice = await seedUser("Alice");
    expect(await pinDocument(db, alice, "missing01")).toBe(false);
    expect(await unpinDocument(db, alice, "missing01")).toBe(false);
  });

  test("HTTP pin requires read access; fail-closed for outsiders", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    const doc = await createDocument(db, { title: "Private", creatorId: owner });
    const app = buildDocumentApp();

    const forbidden = await app.request(`/documents/${doc.id}/pin`, {
      method: "PUT",
      headers: { cookie: await sessionCookieFor(outsider) },
    });
    // Pin is a read-level action; an outsider with no access sees 404, not 403,
    // so the document's existence is not leaked. Decision 003.
    expect(forbidden.status).toBe(404);

    const ok = await app.request(`/documents/${doc.id}/pin`, {
      method: "PUT",
      headers: { cookie: await sessionCookieFor(owner) },
    });
    expect(ok.status).toBe(200);
    expect((await getDocumentTreeForUser(db, { id: owner })).find(n => n.id === doc.id)?.pinned).toBe(true);
  });
});

describe("admin de-privilege over HTTP (owner-scoped, no bypass)", () => {
  test("admin A cannot read admin B's unshared document", async () => {
    const adminA = await seedUser("AdminA", "admin");
    const adminB = await seedUser("AdminB", "admin");
    const docB = await createDocument(db, { title: "B private", creatorId: adminB });
    const app = buildDocumentApp();

    const res = await app.request(`/documents/${docB.id}`, {
      headers: { cookie: await sessionCookieFor(adminA) },
    });
    // No access relationship ⇒ hide existence with 404, not 403. Decision 003.
    expect(res.status).toBe(404);
  });

  test("admin A's list excludes admin B's unshared document", async () => {
    const adminA = await seedUser("AdminA", "admin");
    const adminB = await seedUser("AdminB", "admin");
    const docB = await createDocument(db, { title: "B private", creatorId: adminB });
    const ownDoc = await createDocument(db, { title: "A own", creatorId: adminA });
    const app = buildDocumentApp();

    const res = await app.request("/documents", {
      headers: { cookie: await sessionCookieFor(adminA) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }>; meta: { total: number } };
    const ids = body.data.map(d => d.id);
    expect(ids).toContain(ownDoc.id);
    expect(ids).not.toContain(docB.id);
    expect(body.meta.total).toBe(1);
  });

  test("admin A's tree endpoint excludes admin B's unshared document", async () => {
    const adminA = await seedUser("AdminA", "admin");
    const adminB = await seedUser("AdminB", "admin");
    const docB = await createDocument(db, { title: "B private", creatorId: adminB });
    const ownDoc = await createDocument(db, { title: "A own", creatorId: adminA });
    const app = buildDocumentApp();

    const res = await app.request("/documents/tree", {
      headers: { cookie: await sessionCookieFor(adminA) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    const ids = body.data.map(d => d.id);
    expect(ids).toContain(ownDoc.id);
    expect(ids).not.toContain(docB.id);
  });

  test("owner and explicitly-shared admin can still read the document", async () => {
    const owner = await seedUser("Owner");
    const adminViewer = await seedUser("AdminViewer", "admin");
    const doc = await createDocument(db, { title: "Shared", creatorId: owner });
    await addDocumentShare(policyCtx(owner), {
      documentId: doc.id,
      targetType: "user",
      targetId: adminViewer,
      permission: "viewer",
    });
    const app = buildDocumentApp();

    const ownerRes = await app.request(`/documents/${doc.id}`, {
      headers: { cookie: await sessionCookieFor(owner) },
    });
    expect(ownerRes.status).toBe(200);

    const sharedRes = await app.request(`/documents/${doc.id}`, {
      headers: { cookie: await sessionCookieFor(adminViewer) },
    });
    expect(sharedRes.status).toBe(200);
  });
});

describe("fail-closed 404 existence policy (decision 003)", () => {
  test("no-access read of a document returns 404 (hides existence)", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    const doc = await createDocument(db, { title: "Private", creatorId: owner });
    const app = buildDocumentApp();

    const res = await app.request(`/documents/${doc.id}`, {
      headers: { cookie: await sessionCookieFor(outsider) },
    });
    expect(res.status).toBe(404);
  });

  test("no-access read of a document's shares returns 404 (hides existence)", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    const doc = await createDocument(db, { title: "Private", creatorId: owner });
    const app = buildDocumentApp();

    const res = await app.request(`/documents/${doc.id}/shares`, {
      headers: { cookie: await sessionCookieFor(outsider) },
    });
    expect(res.status).toBe(404);
  });

  test("a viewer can read the document but lacks manage ⇒ 403 on its shares (capability denial stays 403)", async () => {
    const owner = await seedUser("Owner");
    const viewer = await seedUser("Viewer");
    const doc = await createDocument(db, { title: "Shared", creatorId: owner });
    await addDocumentShare(policyCtx(owner), {
      documentId: doc.id,
      targetType: "user",
      targetId: viewer,
      permission: "viewer",
    });
    const app = buildDocumentApp();

    // The viewer can see the document...
    const readRes = await app.request(`/documents/${doc.id}`, {
      headers: { cookie: await sessionCookieFor(viewer) },
    });
    expect(readRes.status).toBe(200);

    // ...but lacks `manage`, so listing its shares is a capability denial (403),
    // NOT a 404 — the viewer already knows the document exists.
    const sharesRes = await app.request(`/documents/${doc.id}/shares`, {
      headers: { cookie: await sessionCookieFor(viewer) },
    });
    expect(sharesRes.status).toBe(403);
  });
});

describe("moveDocument", () => {
  test("re-parents to a sibling and detaches to root (null)", async () => {
    const userId = await seedUser("Alice");
    const a = await createDocument(db, { title: "A", creatorId: userId });
    const b = await createDocument(db, { title: "B", creatorId: userId });
    const child = await createDocument(db, { title: "C", creatorId: userId, parentId: a.id });

    const moved = await moveDocument(db, child.id, b.id);
    if (isVersionConflict(moved))
      expect.unreachable("no conflict expected");
    else
      expect(moved?.parentId).toBe(b.id);

    const detached = await moveDocument(db, child.id, null);
    if (isVersionConflict(detached))
      expect.unreachable("no conflict expected");
    else
      expect(detached?.parentId).toBeNull();
  });

  test("returns undefined for an unknown document", async () => {
    expect(await moveDocument(db, "missing01", null)).toBeUndefined();
  });

  test("surfaces a version conflict when expectedVersion is stale", async () => {
    const userId = await seedUser("Alice");
    const a = await createDocument(db, { title: "A", creatorId: userId });
    const child = await createDocument(db, { title: "C", creatorId: userId });
    await updateDocument(db, child.id, { content: "bump" });
    const result = await moveDocument(db, child.id, a.id, 1);
    expect(isVersionConflict(result)).toBe(true);
  });
});

describe("listDescendantIds + listSoftDeletedDescendants", () => {
  test("listDescendantIds returns every descendant short_id, depth-first", async () => {
    const userId = await seedUser("Alice");
    const root = await createDocument(db, { title: "Root", creatorId: userId });
    const child = await createDocument(db, { title: "Child", creatorId: userId, parentId: root.id });
    const grand = await createDocument(db, { title: "Grand", creatorId: userId, parentId: child.id });

    const ids = await listDescendantIds(db, root.id);
    expect([...ids].sort()).toEqual([child.id, grand.id].sort());
    expect(await listDescendantIds(db, "missing01")).toEqual([]);
  });

  test("listSoftDeletedDescendants surfaces the deleted subtree for admin UI", async () => {
    const userId = await seedUser("Alice");
    const root = await createDocument(db, { title: "Root", creatorId: userId });
    const child = await createDocument(db, { title: "Child", creatorId: userId, parentId: root.id });
    await softDeleteDocument(db, root.id);

    const descendants = await listSoftDeletedDescendants(db, root.id);
    expect(descendants.map(d => d.id)).toEqual([child.id]);
    expect(await listSoftDeletedDescendants(db, "missing01")).toEqual([]);
  });
});

describe("listMyDocuments filtering", () => {
  test("q filters by title; tag filters by assigned tag", async () => {
    const me = await seedUser("Me");
    const alpha = await createDocument(db, { title: "Quarterly Report", creatorId: me, tags: ["finance"] });
    await createDocument(db, { title: "Random Notes", creatorId: me, tags: ["misc"] });

    const byQuery = await listMyDocuments(db, { userId: me, q: "quarterly" });
    expect(byQuery.data.map(d => d.id)).toEqual([alpha.id]);

    const byTag = await listMyDocuments(db, { userId: me, tag: "finance" });
    expect(byTag.data.map(d => d.id)).toEqual([alpha.id]);

    const byMissingTag = await listMyDocuments(db, { userId: me, tag: "nope" });
    expect(byMissingTag.total).toBe(0);
  });

  test("paginates with a bounded limit", async () => {
    const me = await seedUser("Me");
    for (let i = 0; i < 3; i++)
      await createDocument(db, { title: `Doc ${i}`, creatorId: me });
    const page1 = await listMyDocuments(db, { userId: me, page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.data).toHaveLength(2);
    const page2 = await listMyDocuments(db, { userId: me, page: 2, limit: 2 });
    expect(page2.data).toHaveLength(1);
  });

  test("q treats % and _ as literals, not LIKE wildcards (ESCAPE clause)", async () => {
    const me = await seedUser("Me");
    const pct = await createDocument(db, { title: "50% off sale", creatorId: me });
    await createDocument(db, { title: "50 off sale", creatorId: me });
    const under = await createDocument(db, { title: "a_b config", creatorId: me });
    await createDocument(db, { title: "axb config", creatorId: me });

    // A literal "%" must match only the title that actually contains it.
    // Without the ESCAPE clause the escaped term ("50\% off") matches
    // nothing (the backslash is taken literally), so this would be empty.
    const byPercent = await listMyDocuments(db, { userId: me, q: "50% off" });
    expect(byPercent.data.map(d => d.id)).toEqual([pct.id]);

    // A literal "_" must not behave as the single-char wildcard: "a_b"
    // matches, "axb" does not.
    const byUnderscore = await listMyDocuments(db, { userId: me, q: "a_b" });
    expect(byUnderscore.data.map(d => d.id)).toEqual([under.id]);
  });
});

describe("listAllTags + tag cache", () => {
  test("returns the distinct sorted tag set and refreshes after invalidation", async () => {
    const me = await seedUser("Me");
    await createDocument(db, { title: "A", creatorId: me, tags: ["zeta", "alpha"] });
    expect(await listAllTags(db)).toEqual(["alpha", "zeta"]);

    // Cached read returns the same set; a new tag only appears after invalidation.
    await createDocument(db, { title: "B", creatorId: me, tags: ["beta"] });
    invalidateTagCache();
    expect(await listAllTags(db)).toEqual(["alpha", "beta", "zeta"]);
  });
});

describe("listAllGroups", () => {
  test("returns groups ordered by name", async () => {
    const now = new Date().toISOString();
    await db.insert(groups).values([
      { id: nanoid(), name: "Zebra", createdAt: now, updatedAt: now },
      { id: nanoid(), name: "Apple", createdAt: now, updatedAt: now },
    ]).run();
    const list = await listAllGroups(db);
    expect(list.map(g => g.name)).toEqual(["Apple", "Zebra"]);
  });
});

describe("getDocumentShareById", () => {
  test("resolves a share tuple to its document short_id; undefined for unknown ids", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const doc = await createDocument(db, { title: "D", creatorId: alice });
    const share = await addDocumentShare(policyCtx(alice), {
      documentId: doc.id,
      targetType: "user",
      targetId: bob,
      permission: "viewer",
    });

    const resolved = await getDocumentShareById(db, share.id);
    expect(resolved?.documentId).toBe(doc.id);
    expect(resolved?.targetId).toBe(bob);
    expect(await getDocumentShareById(db, "missing-tuple")).toBeUndefined();
  });
});

describe("softDeleteDocument cascades public-link cleanup", () => {
  test("deletes the public link of the root and of every descendant", async () => {
    const owner = await seedUser("Owner");
    const root = await createDocument(db, { title: "Root", creatorId: owner });
    const child = await createDocument(db, { title: "Child", creatorId: owner, parentId: root.id });

    await createShare(db, { resourceType: "document", resourceId: root.id, createdBy: owner, shareType: "public_link", permission: "view" });
    await createShare(db, { resourceType: "document", resourceId: child.id, createdBy: owner, shareType: "public_link", permission: "view" });
    expect((await listSharesForResource(db, "document", root.id)).length).toBe(1);
    expect((await listSharesForResource(db, "document", child.id)).length).toBe(1);

    await softDeleteDocument(db, root.id);

    // Both the directly-shared root and the cascaded child lose their links.
    expect((await listSharesForResource(db, "document", root.id)).length).toBe(0);
    expect((await listSharesForResource(db, "document", child.id)).length).toBe(0);
  });
});
