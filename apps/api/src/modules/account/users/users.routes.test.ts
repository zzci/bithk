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
import { userRoutes } from "./users.routes";
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
  app.route("/", userRoutes());
  app.onError(errorHandler);
  return app;
}

let db: AppDatabase;
let dbPath: string;

async function sessionForUser(): Promise<string> {
  const id = nanoid();
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
  const sessionId = await createSession(db, id, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function putPref(cookie: string, value: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({ value }),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-users-routes-${Date.now()}-${nanoid()}`);
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

describe("PUT /account/me/preferences/:key bounds (FIX-AUDIT-016)", () => {
  test("a normal preference is stored (200)", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const res = await app.request("/account/me/preferences/theme", putPref(cookie, "dark"));
    expect(res.status).toBe(200);
  });

  test("an over-long key is rejected with 422", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const res = await app.request(`/account/me/preferences/${"k".repeat(201)}`, putPref(cookie, "x"));
    expect(res.status).toBe(422);
  });

  test("an over-large serialized value is rejected with 413", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const big = "a".repeat(64 * 1024 + 1);
    const res = await app.request("/account/me/preferences/blob", putPref(cookie, big));
    expect(res.status).toBe(413);
  });
});
