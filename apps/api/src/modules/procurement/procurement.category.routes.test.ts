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
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { errorHandler } from "@/shared/middleware/error-handler";
import { createCategory } from "./procurement.categories";
import { procurementRoutes } from "./procurement.routes";
// Registers the session-cookie auth provider that `authRequired` resolves
// through — without it the middleware throws.
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
    SESSION_MAX_AGE: 86400,
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_LOCAL_ROOT: "data/uploads/files",
    SINGLE_USER_MODE: false,
  } as unknown as Config;
}

function buildApp(db: AppDatabase): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", stubLogger);
    await next();
  });
  app.route("/", procurementRoutes());
  app.onError(errorHandler);
  return app;
}

let db: AppDatabase;
let dbPath: string;

async function seedUser(role: "admin" | "user" = "user"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** Seed a user + a live session and return its Cookie header. */
async function sessionFor(role: "admin" | "user" = "user"): Promise<{ userId: string; cookie: string }> {
  const userId = await seedUser(role);
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return { userId, cookie: `session_id=${sessionId}` };
}

/** Issue a live session for an existing user id. */
async function cookieForUser(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Reader")!.id;
}

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-procurement-category-${Date.now()}-${nanoid()}`);
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

describe("procurement category PATCH on a missing id", () => {
  test("returns 404 while an existing category patches normally", async () => {
    const app = buildApp(db);
    // The creator is seeded as the Project Owner member → holds categories.manage.
    const owner = await seedUser();
    const project = await createProject(db, { name: "P", creatorId: owner });
    const sessionId = await createSession(db, owner, "access-token", undefined, 3600);
    const cookie = `session_id=${sessionId}`;

    // A real category still patches (guards against a false 404 on the happy path).
    const category = await createCategory(db, project.id, { name: "Materials", code: "MAT" });
    const ok = await app.request(
      `/projects/${project.shortId}/procurement-categories/${category.id}`,
      jsonReq("PATCH", cookie, { name: "Raw materials" }),
    );
    expect(ok.status).toBe(200);

    // PATCH on a non-existent category id hits the `updateCategory → undefined`
    // → NotFoundError branch.
    const missing = await app.request(
      `/projects/${project.shortId}/procurement-categories/does-not-exist`,
      jsonReq("PATCH", cookie, { name: "Ghost" }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("procurement categories (categories.manage gate)", () => {
  test("pm CRUDs a category; a plain member cannot create", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const cookie = await cookieForUser(owner);

    const denied = await app.request(`/projects/${project.shortId}/procurement-categories`, jsonReq("POST", await cookieForUser(bob), { name: "Materials" }));
    expect(denied.status).toBe(403);

    const created = await app.request(`/projects/${project.shortId}/procurement-categories`, jsonReq("POST", cookie, { name: "Materials", code: "MAT" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: { id: string } }).data;

    const patched = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("PATCH", cookie, { name: "Raw materials" }));
    expect((await patched.json() as { data: { name: string } }).data.name).toBe("Raw materials");

    const removed = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("DELETE", cookie));
    expect(removed.status).toBe(200);

    const missing = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("DELETE", cookie));
    expect(missing.status).toBe(404);
  });
});

describe("global procurement categories (admin only)", () => {
  test("a non-admin is blocked; an admin CRUDs the global set", async () => {
    const app = buildApp(db);
    const user = await sessionFor("user");
    const admin = await sessionFor("admin");

    const denied = await app.request("/global-procurement-categories", jsonReq("POST", user.cookie, { name: "X" }));
    expect(denied.status).toBe(403);
    const deniedList = await app.request("/global-procurement-categories", { headers: { Cookie: user.cookie } });
    expect(deniedList.status).toBe(403);

    const created = await app.request("/global-procurement-categories", jsonReq("POST", admin.cookie, { name: "Engine", code: "ENG" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: { id: string } }).data;

    const list = await app.request("/global-procurement-categories", { headers: { Cookie: admin.cookie } });
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(1);

    const patched = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("PATCH", admin.cookie, { name: "Engine room" }));
    expect((await patched.json() as { data: { name: string } }).data.name).toBe("Engine room");

    const removed = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("DELETE", admin.cookie));
    expect(removed.status).toBe(200);
    const missing = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("DELETE", admin.cookie));
    expect(missing.status).toBe(404);
  });
});
