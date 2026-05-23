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
import { users } from "@/modules/account/users/schema";
import { createDocument, softDeleteDocument } from "@/modules/document/document.service";
import { createDriveFolder, uploadDriveFile } from "@/modules/drive/drive.service";
import { uploadAndReference } from "@/modules/file";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { items } from "@/modules/item/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { errorHandler } from "@/shared/middleware/error-handler";
import { sharePublicRoutes } from "./share.public.routes";
import { shareRoutes } from "./share.routes";
import { createShare } from "./share.service";
// Side-effect imports: register the auth provider + share adapters.
import "@/modules/account";
import "@/modules/drive/drive.share-adapter";
import "@/modules/document/document.share-adapter";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;
let storageRoot: string;

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
    FILE_STORAGE_LOCAL_ROOT: storageRoot,
    FILE_GC_MODE: "sync",
    FILE_GC_INTERVAL_SECONDS: 3600,
    FILE_PRESIGN_ENABLED: false,
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

// The authenticated management routes and the anonymous public routes live in
// separate route trees in production (routes/protected.ts vs routes/public.ts).
// Keep them on separate test apps too: mounting both at "/" would let the
// management router's global `authRequired` shadow the public `/shared/*` paths.
function withContext(router: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", noopLogger);
    await next();
  });
  app.route("/", router);
  app.onError(errorHandler);
  return app;
}

function buildApp(): Hono<AppEnv> {
  return withContext(shareRoutes());
}

function buildPublicApp(): Hono<AppEnv> {
  return withContext(sharePublicRoutes());
}

async function seedUser(name: string) {
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

async function sessionCookieFor(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "test-access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function textFile(name: string, body = "hello"): File {
  return new File([body], name, { type: "text/plain" });
}

async function seedDriveFile(owner: string, name = "doc.txt") {
  const entry = await uploadDriveFile(db, baseConfig(), { ownerType: "user", ownerId: owner, createdBy: owner, file: textFile(name) });
  return entry.id;
}

async function itemIdForShortId(shortId: string): Promise<string> {
  const row = await db.select({ id: items.id }).from(items).where(eq(items.shortId, shortId)).get();
  return row!.id;
}

async function jsonPost(app: Hono<AppEnv>, path: string, cookie: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-share-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  storageRoot = resolve(dir, "blobs");
  db = await createDb(dbPath);
  loadNamespaces();
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(storageRoot);
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("share routes — capabilities + auth", () => {
  test("rejects unauthenticated access", async () => {
    const app = buildApp();
    const res = await app.request("/shares/received");
    expect(res.status).toBe(401);
  });

  test("exposes per-resource-type capabilities", async () => {
    const owner = await seedUser("Owner");
    const app = buildApp();
    const res = await app.request("/shares/capabilities/document", {
      headers: { cookie: await sessionCookieFor(owner) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { shareTypes: string[]; permissions: string[] } };
    expect(body.data.shareTypes).toEqual(["public_link"]);
    expect(body.data.permissions).toEqual(["view"]);
  });

  test("422 for an unknown resource type", async () => {
    const owner = await seedUser("Owner");
    const app = buildApp();
    const res = await app.request("/shares/capabilities/bogus", {
      headers: { cookie: await sessionCookieFor(owner) },
    });
    expect(res.status).toBe(422);
  });
});

describe("share routes — create / list authorization", () => {
  test("owner creates a document public link; non-owner is forbidden", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    const app = buildApp();

    const denied = await jsonPost(app, `/shares/document/${doc.id}`, await sessionCookieFor(outsider), { shareType: "public_link", permission: "view" });
    expect(denied.status).toBe(403);

    const created = await jsonPost(app, `/shares/document/${doc.id}`, await sessionCookieFor(owner), { shareType: "public_link", permission: "view" });
    expect(created.status).toBe(201);
    const body = await created.json() as { data: { token: string; resourceName: string } };
    expect(body.data.token).toHaveLength(10);
    expect(body.data.resourceName).toBe("Doc");
  });

  test("non-owner cannot list a document's shares", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    await createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildApp();

    const denied = await app.request(`/shares/document/${doc.id}`, { headers: { cookie: await sessionCookieFor(outsider) } });
    expect(denied.status).toBe(403);

    const ok = await app.request(`/shares/document/${doc.id}`, { headers: { cookie: await sessionCookieFor(owner) } });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test("rejects an invalid (non-ISO) expiresAt at the boundary", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedDriveFile(owner);
    const app = buildApp();
    const res = await jsonPost(app, `/shares/drive_entry/${entryId}`, await sessionCookieFor(owner), {
      shareType: "public_link",
      permission: "view",
      expiresAt: "not-a-date",
    });
    expect(res.status).toBe(422);
  });

  test("accepts a well-formed ISO expiresAt", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedDriveFile(owner);
    const app = buildApp();
    const res = await jsonPost(app, `/shares/drive_entry/${entryId}`, await sessionCookieFor(owner), {
      shareType: "public_link",
      permission: "view",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
  });
});

describe("share routes — update / revoke ownership", () => {
  test("only the creator may update or revoke", async () => {
    const owner = await seedUser("Owner");
    const other = await seedUser("Other");
    const entryId = await seedDriveFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildApp();

    const deniedPatch = await app.request(`/shares/${view.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "cookie": await sessionCookieFor(other) },
      body: JSON.stringify({ isActive: false }),
    });
    expect(deniedPatch.status).toBe(403);

    const okPatch = await app.request(`/shares/${view.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "cookie": await sessionCookieFor(owner) },
      body: JSON.stringify({ isActive: false }),
    });
    expect(okPatch.status).toBe(200);

    const deniedDelete = await app.request(`/shares/${view.id}`, { method: "DELETE", headers: { cookie: await sessionCookieFor(other) } });
    expect(deniedDelete.status).toBe(403);
  });

  test("update with an empty body is rejected", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedDriveFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildApp();
    const res = await app.request(`/shares/${view.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "cookie": await sessionCookieFor(owner) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});

describe("share routes — inboxes", () => {
  test("received / sent / links segregate by role and share type", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedDriveFile(owner);
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    const app = buildApp();

    const sent = await (await app.request("/shares/sent", { headers: { cookie: await sessionCookieFor(owner) } })).json() as { data: unknown[] };
    const links = await (await app.request("/shares/links", { headers: { cookie: await sessionCookieFor(owner) } })).json() as { data: unknown[] };
    const received = await (await app.request("/shares/received", { headers: { cookie: await sessionCookieFor(recipient) } })).json() as { data: unknown[] };
    expect(sent.data).toHaveLength(1);
    expect(links.data).toHaveLength(1);
    expect(received.data).toHaveLength(1);
  });
});

describe("public share routes — document content", () => {
  test("GET meta then POST returns content + subtree", async () => {
    const owner = await seedUser("Owner");
    const root = await createDocument(db, { title: "Root", creatorId: owner, content: "# hi" });
    await createDocument(db, { title: "Child", creatorId: owner, parentId: root.id });
    const view = await createShare(db, { resourceType: "document", resourceId: root.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildPublicApp();

    const meta = await (await app.request(`/shared/${view.token}`)).json() as { data: { name: string; requiresPassword: boolean } };
    expect(meta.data.name).toBe("Root");
    expect(meta.data.requiresPassword).toBe(false);

    const content = await app.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(content.status).toBe(200);
    const body = await content.json() as { data: { document: { title: string }; subtree: unknown[] } };
    expect(body.data.document.title).toBe("Root");
    expect(body.data.subtree).toHaveLength(2);
  });

  test("a revoked link resolves to 404", async () => {
    const owner = await seedUser("Owner");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    const view = await createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const authApp = buildApp();
    const publicApp = buildPublicApp();

    await authApp.request(`/shares/${view.id}`, { method: "DELETE", headers: { cookie: await sessionCookieFor(owner) } });

    const meta = await publicApp.request(`/shared/${view.token}`);
    expect(meta.status).toBe(404);
    const content = await publicApp.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(content.status).toBe(404);
  });

  test("deleting the document tears down its public link", async () => {
    const owner = await seedUser("Owner");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    const view = await createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildPublicApp();

    // Soft-delete via the document service cascade (mirrors the delete route).
    await softDeleteDocument(db, doc.id);

    const meta = await app.request(`/shared/${view.token}`);
    expect(meta.status).toBe(404);
  });
});

describe("public share routes — password / expiry gate", () => {
  test("password-protected document link enforces the password", async () => {
    const owner = await seedUser("Owner");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    const view = await createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "view", password: "s3cret" });
    const app = buildPublicApp();

    const noPw = await app.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(noPw.status).toBe(403);

    const wrongPw = await app.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
    expect(wrongPw.status).toBe(403);

    const okPw = await app.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "s3cret" }) });
    expect(okPw.status).toBe(200);
  });

  test("an expired link returns 410", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedDriveFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view", expiresAt: "2000-01-01T00:00:00.000Z" });
    const app = buildPublicApp();

    const meta = await (await app.request(`/shared/${view.token}`)).json() as { data: { expired: boolean } };
    expect(meta.data.expired).toBe(true);

    const content = await app.request(`/shared/${view.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(content.status).toBe(410);
  });

  test("a direct share is not reachable by token", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedDriveFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    const app = buildPublicApp();
    const res = await app.request(`/shared/${view.token}`);
    expect(res.status).toBe(404);
  });
});

describe("public share routes — document attachment download (IDOR guard)", () => {
  test("downloads an attachment inside the shared subtree, rejects one outside it", async () => {
    const owner = await seedUser("Owner");
    const shared = await createDocument(db, { title: "Shared", creatorId: owner });
    const other = await createDocument(db, { title: "Other", creatorId: owner });
    const sharedItemId = await itemIdForShortId(shared.id);
    const otherItemId = await itemIdForShortId(other.id);

    const inside = await uploadAndReference(db, baseConfig(), { file: textFile("inside.txt", "in"), ownerType: "item_attachment", ownerId: sharedItemId, uploadedBy: owner });
    const outside = await uploadAndReference(db, baseConfig(), { file: textFile("outside.txt", "out"), ownerType: "item_attachment", ownerId: otherItemId, uploadedBy: owner });

    const view = await createShare(db, { resourceType: "document", resourceId: shared.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildPublicApp();

    const ok = await app.request(`/shared/${view.token}/download/${inside.reference.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("in");

    // The attachment belongs to a document outside the link's subtree → 404.
    const idor = await app.request(`/shared/${view.token}/download/${outside.reference.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(idor.status).toBe(404);
  });
});

describe("public share routes — folder download budget (drive adapter)", () => {
  test("maxDownloads exhaustion returns 410 over HTTP", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "Box" });
    const child = await uploadDriveFile(db, baseConfig(), { ownerType: "user", ownerId: owner, createdBy: owner, parentEntryId: folder.id, file: textFile("inside.txt") });
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: folder.id, createdBy: owner, shareType: "public_link", permission: "download", maxDownloads: 1 });
    const app = buildPublicApp();

    const first = await app.request(`/shared/${view.token}/download/${child.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(first.status).toBe(200);
    const second = await app.request(`/shared/${view.token}/download/${child.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(second.status).toBe(410);
  });

  test("lists folder children over HTTP", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "Box" });
    await uploadDriveFile(db, baseConfig(), { ownerType: "user", ownerId: owner, createdBy: owner, parentEntryId: folder.id, file: textFile("inside.txt") });
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: folder.id, createdBy: owner, shareType: "public_link", permission: "view" });
    const app = buildPublicApp();

    const res = await app.request(`/shared/${view.token}/list`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entries: { name: string }[] } };
    expect(body.data.entries.map(e => e.name)).toContain("inside.txt");
  });
});
