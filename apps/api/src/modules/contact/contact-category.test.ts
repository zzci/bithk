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
import { users } from "@/modules/account/users/schema";
import { policyMiddleware } from "@/modules/policy";
import { errorHandler } from "@/shared/middleware/error-handler";
import { contactRoutes } from "./contact.routes";
import "@/modules/account";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const stubLogger = {
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

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-contact-category-${Date.now()}-${nanoid()}`);
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

describe("contact categories (admin only)", () => {
  test("a non-admin is blocked on list and create", async () => {
    const app = buildApp();
    const user = await seedUser("user-a", "user");

    const deniedList = await app.request("/contact-categories", { headers: { "x-uid": user } });
    expect(deniedList.status).toBe(403);

    const deniedCreate = await app.request("/contact-categories", jsonReq(user, "POST", { name: "Suppliers" }));
    expect(deniedCreate.status).toBe(403);
  });

  test("an admin CRUDs the global set", async () => {
    const app = buildApp();
    const admin = await seedUser("admin-a", "admin");

    const created = await app.request("/contact-categories", jsonReq(admin, "POST", { name: "Suppliers", code: "SUP" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: CategoryView }).data;
    expect(cat.name).toBe("Suppliers");
    expect(cat.code).toBe("SUP");

    const list = await app.request("/contact-categories", { headers: { "x-uid": admin } });
    expect(list.status).toBe(200);
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(1);

    const patched = await app.request(`/contact-categories/${cat.id}`, jsonReq(admin, "PATCH", { name: "Vendors" }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { data: CategoryView }).data.name).toBe("Vendors");

    const removed = await app.request(`/contact-categories/${cat.id}`, { method: "DELETE", headers: { "x-uid": admin } });
    expect(removed.status).toBe(200);

    const missing = await app.request(`/contact-categories/${cat.id}`, { method: "DELETE", headers: { "x-uid": admin } });
    expect(missing.status).toBe(404);

    const missingPatch = await app.request(`/contact-categories/${cat.id}`, jsonReq(admin, "PATCH", { name: "X" }));
    expect(missingPatch.status).toBe(404);
  });

  test("a contact round-trips its categoryId", async () => {
    const app = buildApp();
    const admin = await seedUser("admin-a", "admin");
    const owner = await seedUser("owner-a", "user");

    const created = await app.request("/contact-categories", jsonReq(admin, "POST", { name: "Suppliers" }));
    const catId = (await created.json() as { data: CategoryView }).data.id;

    const contact = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "Acme", phone: "1", categoryId: catId }));
    expect(contact.status).toBe(201);
    const contactData = (await contact.json() as { data: ContactView }).data;
    expect(contactData.categoryId).toBe(catId);

    const fetched = await app.request(`/contacts/${contactData.id}`, { headers: { "x-uid": owner } });
    expect((await fetched.json() as { data: ContactView }).data.categoryId).toBe(catId);
  });

  test("deleting a category sets referencing contacts.category_id to NULL", async () => {
    const app = buildApp();
    const admin = await seedUser("admin-a", "admin");
    const owner = await seedUser("owner-a", "user");

    const created = await app.request("/contact-categories", jsonReq(admin, "POST", { name: "Suppliers" }));
    const catId = (await created.json() as { data: CategoryView }).data.id;

    const contact = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "Acme", phone: "1", categoryId: catId }));
    const contactId = (await contact.json() as { data: ContactView }).data.id;

    const removed = await app.request(`/contact-categories/${catId}`, { method: "DELETE", headers: { "x-uid": admin } });
    expect(removed.status).toBe(200);

    const fetched = await app.request(`/contacts/${contactId}`, { headers: { "x-uid": owner } });
    expect((await fetched.json() as { data: ContactView }).data.categoryId).toBeNull();
  });

  test("update can clear a contact's categoryId", async () => {
    const app = buildApp();
    const admin = await seedUser("admin-a", "admin");
    const owner = await seedUser("owner-a", "user");

    const created = await app.request("/contact-categories", jsonReq(admin, "POST", { name: "Suppliers" }));
    const catId = (await created.json() as { data: CategoryView }).data.id;

    const contact = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "Acme", phone: "1", categoryId: catId }));
    const contactId = (await contact.json() as { data: ContactView }).data.id;

    const patched = await app.request(`/contacts/${contactId}`, jsonReq(owner, "PATCH", { categoryId: null }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { data: ContactView }).data.categoryId).toBeNull();
  });
});

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", stubLogger);
    c.set("requestId", "test");
    const uid = c.req.header("x-uid");
    if (uid) {
      const user = await db.select().from(users).where(eq(users.id, uid)).get();
      if (user)
        c.set("user", user);
    }
    await next();
  });
  app.use("*", policyMiddleware({ basePath: "" }));
  app.route("/", contactRoutes());
  app.onError(errorHandler);
  return app;
}

async function seedUser(id: string, role: "admin" | "user"): Promise<string> {
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@test.local`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function jsonReq(userId: string, method: string, body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json", "x-uid": userId },
    body: JSON.stringify(body),
  };
}

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
}

interface ContactView {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
}
