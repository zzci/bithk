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
import { createProject } from "@/modules/project/project.service";
import { errorHandler } from "@/shared/middleware/error-handler";
import { registerTagSource } from "./tag.registry";
import { tagRoutes } from "./tag.routes";
// Registers the session-cookie auth provider that `authRequired` resolves
// through — without it the middleware throws.
import "@/modules/account";

// Wire the tag types into the registry so `/tags` resolves a binding per type.
// Mirrors the load-time registration in `routes/protected.ts`; idempotent so
// re-running the suite is safe.
registerTagSource({ type: "project" });
registerTagSource({ type: "contact" });
registerTagSource({ type: "document" });

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
    SESSION_MAX_AGE: 86400,
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
  app.route("/", tagRoutes());
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

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-tag-routes-${Date.now()}-${nanoid()}`);
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

describe("GET /tags", () => {
  test("lists the global tag vocabulary for any authenticated user", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    await createProject(db, { name: "P", creatorId: owner, tags: ["alpha", "beta"] });
    const res = await app.request("/tags", { headers: { Cookie: await cookieForUser(owner) } });
    expect(res.status).toBe(200);
    const names = (await res.json() as { data: { name: string }[] }).data.map(t => t.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});

describe("tag admin (admin only)", () => {
  test("a non-admin cannot mutate tags; an admin can create/rename/delete", async () => {
    const app = buildApp(db);
    const user = await sessionFor("user");
    const admin = await sessionFor("admin");

    const denied = await app.request("/tags", jsonReq("POST", user.cookie, { name: "X" }));
    expect(denied.status).toBe(403);

    const created = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Coastal" }));
    expect(created.status).toBe(201);
    const tag = (await created.json() as { data: { id: string; name: string } }).data;
    expect(tag.name).toBe("Coastal");

    const renamed = await app.request(`/tags/${tag.id}`, jsonReq("PATCH", admin.cookie, { name: "Offshore" }));
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { data: { name: string } }).data.name).toBe("Offshore");

    const removed = await app.request(`/tags/${tag.id}`, jsonReq("DELETE", admin.cookie));
    expect(removed.status).toBe(200);

    const missing = await app.request(`/tags/${tag.id}`, jsonReq("DELETE", admin.cookie));
    expect(missing.status).toBe(404);
  });

  test("a duplicate tag name is rejected with 422", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Dup" }));
    const res = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Dup" }));
    expect(res.status).toBe(422);
  });
});

describe("typed /tags admin", () => {
  interface TagBody { data: { id: string; name: string; usageCount: number } }

  test("type defaults to project and scopes list/create per source type", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    // POST without `type` creates a project tag; a contact tag may reuse the name.
    const projectTag = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "VIP" }));
    expect(projectTag.status).toBe(201);
    const contactTag = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "VIP", type: "contact" }));
    expect(contactTag.status).toBe(201);
    expect((await contactTag.json() as TagBody).data.id)
      .not
      .toBe((await projectTag.json() as TagBody).data.id);

    // A same-type duplicate is rejected.
    const dup = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "VIP" }));
    expect(dup.status).toBe(422);

    // GET defaults to project; ?type=contact returns the contact vocabulary.
    const projectList = await app.request("/tags", { headers: { Cookie: admin.cookie } });
    expect((await projectList.json() as { data: { name: string }[] }).data.map(t => t.name)).toEqual(["VIP"]);
    const contactList = await app.request("/tags?type=contact", { headers: { Cookie: admin.cookie } });
    expect((await contactList.json() as { data: { name: string }[] }).data.map(t => t.name)).toEqual(["VIP"]);
  });

  test("deleting a tag is scoped by type", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const created = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "temp", type: "contact" }));
    const tagId = (await created.json() as TagBody).data.id;

    // Wrong type → 404; correct type → 200; second delete → 404.
    expect((await app.request(`/tags/${tagId}`, jsonReq("DELETE", admin.cookie))).status).toBe(404);
    expect((await app.request(`/tags/${tagId}?type=contact`, jsonReq("DELETE", admin.cookie))).status).toBe(200);
    expect((await app.request(`/tags/${tagId}?type=contact`, jsonReq("DELETE", admin.cookie))).status).toBe(404);
  });
});
