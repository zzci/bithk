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
import { errorHandler } from "@/shared/middleware/error-handler";
import { shipRoutes } from "./ship.routes";
// Registers the session-cookie auth provider that `authRequired` resolves through.
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
  app.route("/", shipRoutes());
  app.onError(errorHandler);
  return app;
}

let db: AppDatabase;
let dbPath: string;

async function seedUser(role: "admin" | "user"): Promise<string> {
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

async function cookieFor(role: "admin" | "user"): Promise<string> {
  const userId = await seedUser(role);
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function jsonReq(cookie: string, method: string, body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  };
}

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-worklist-category-${Date.now()}-${nanoid()}`);
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

describe("worklist categories (admin only)", () => {
  test("a non-admin is blocked on list and create", async () => {
    const app = buildApp(db);
    const cookie = await cookieFor("user");

    const deniedList = await app.request("/worklist-categories", { headers: { cookie } });
    expect(deniedList.status).toBe(403);

    const deniedCreate = await app.request("/worklist-categories", jsonReq(cookie, "POST", { name: "Routine Maintenance" }));
    expect(deniedCreate.status).toBe(403);
  });

  test("an admin CRUDs the global set", async () => {
    const app = buildApp(db);
    const cookie = await cookieFor("admin");

    const created = await app.request("/worklist-categories", jsonReq(cookie, "POST", { name: "Routine Maintenance", description: "Scheduled upkeep" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: CategoryView }).data;
    expect(cat.name).toBe("Routine Maintenance");
    expect(cat.description).toBe("Scheduled upkeep");

    const list = await app.request("/worklist-categories", { headers: { cookie } });
    expect(list.status).toBe(200);
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(1);

    const patched = await app.request(`/worklist-categories/${cat.id}`, jsonReq(cookie, "PATCH", { name: "Safety Inspection" }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { data: CategoryView }).data.name).toBe("Safety Inspection");

    const removed = await app.request(`/worklist-categories/${cat.id}`, { method: "DELETE", headers: { cookie } });
    expect(removed.status).toBe(200);

    const missing = await app.request(`/worklist-categories/${cat.id}`, { method: "DELETE", headers: { cookie } });
    expect(missing.status).toBe(404);

    const missingPatch = await app.request(`/worklist-categories/${cat.id}`, jsonReq(cookie, "PATCH", { name: "X" }));
    expect(missingPatch.status).toBe(404);
  });

  test("create rejects an empty name and patch rejects an empty body", async () => {
    const app = buildApp(db);
    const cookie = await cookieFor("admin");

    const badCreate = await app.request("/worklist-categories", jsonReq(cookie, "POST", { name: "" }));
    expect(badCreate.status).toBe(422);

    const created = await app.request("/worklist-categories", jsonReq(cookie, "POST", { name: "Equipment Repair" }));
    const cat = (await created.json() as { data: CategoryView }).data;

    const emptyPatch = await app.request(`/worklist-categories/${cat.id}`, jsonReq(cookie, "PATCH", {}));
    expect(emptyPatch.status).toBe(422);
  });
});
