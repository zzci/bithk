import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { setSetting } from "@/modules/settings/settings.service";
import { errorHandler } from "@/shared/middleware/error-handler";
import { systemRoutes } from "./system.routes";
// Importing the account module registers the real session-cookie auth
// provider that `authRequired` resolves through. Anonymous requests carry no
// session cookie → the provider returns undefined → 401. The user-set cases
// below short-circuit `authRequired` before the provider is ever consulted.
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

function config(overrides: Partial<Config> = {}): Config {
  return {
    APP_DISPLAY_NAME: "App",
    MAX_UPLOAD_BYTES: 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 5,
    UPLOADS_TOTAL_BYTES: 0,
    SERVICE_TOKEN_METRICS: undefined,
    ...overrides,
  } as Config;
}

const adminUser = { id: "a", role: "admin" } as User;
const normalUser = { id: "u", role: "user" } as User;

interface AppOpts {
  db?: unknown;
  cfg?: Config;
  user?: User;
}

let db: AppDatabase;
let dbPath: string;

function buildApp(opts: AppOpts = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", (opts.db ?? db) as AppDatabase);
    c.set("config", opts.cfg ?? config());
    c.set("logger", stubLogger);
    if (opts.user)
      c.set("user", opts.user);
    await next();
  });
  app.route("/", systemRoutes());
  app.onError(errorHandler);
  return app;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-system-${Date.now()}-${nanoid()}`);
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

describe("GET /health", () => {
  test("returns 200 ok without auth", async () => {
    const res = await buildApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /health/ready", () => {
  test("returns ready when the DB ping succeeds", async () => {
    const res = await buildApp().request("/health/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  test("returns 503 db_unavailable when the DB ping fails", async () => {
    const brokenDb = {
      run: async () => {
        throw new Error("connection lost");
      },
    };
    const res = await buildApp({ db: brokenDb }).request("/health/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "db_unavailable" });
  });
});

describe("GET /system/branding", () => {
  test("returns the configured display name without auth", async () => {
    const res = await buildApp({ cfg: config({ APP_DISPLAY_NAME: "Runtime App" }) }).request("/system/branding");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appDisplayName: "Runtime App" },
    });
  });

  test("prefers the settings table display name over config", async () => {
    await setSetting(db, "app.display_name", "Settings App");
    const res = await buildApp({ cfg: config({ APP_DISPLAY_NAME: "Runtime App" }) }).request("/system/branding");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appDisplayName: "Settings App" },
    });
  });
});

describe("GET /system/version", () => {
  test("401 when anonymous", async () => {
    const res = await buildApp().request("/system/version");
    expect(res.status).toBe(401);
  });

  test("403 for a non-admin user", async () => {
    const res = await buildApp({ user: normalUser }).request("/system/version");
    expect(res.status).toBe(403);
  });

  test("200 with build info for an admin", async () => {
    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });
});

describe("GET /metrics", () => {
  test("503 when the metrics service token is not configured", async () => {
    const res = await buildApp().request("/metrics");
    expect(res.status).toBe(503);
  });

  test("401 without a token when configured", async () => {
    const res = await buildApp({ cfg: config({ SERVICE_TOKEN_METRICS: "tok" }) }).request("/metrics");
    expect(res.status).toBe(401);
  });

  test("200 Prometheus text with the correct token", async () => {
    const res = await buildApp({ cfg: config({ SERVICE_TOKEN_METRICS: "tok" }) }).request("/metrics", {
      headers: { authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});

describe("GET /system/upload-limits", () => {
  test("401 when anonymous", async () => {
    const res = await buildApp().request("/system/upload-limits");
    expect(res.status).toBe(401);
  });

  test("returns configured limits for an authenticated user, null quota when 0", async () => {
    const res = await buildApp({ user: normalUser }).request("/system/upload-limits");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { maxFileSize: number; maxAttachmentsPerResource: number; totalQuota: number | null } };
    expect(body.data.maxFileSize).toBe(1024);
    expect(body.data.maxAttachmentsPerResource).toBe(5);
    expect(body.data.totalQuota).toBeNull();
  });

  test("exposes the total quota when set", async () => {
    const res = await buildApp({ user: normalUser, cfg: config({ UPLOADS_TOTAL_BYTES: 9999 }) })
      .request("/system/upload-limits");
    const body = await res.json() as { data: { totalQuota: number | null } };
    expect(body.data.totalQuota).toBe(9999);
  });
});
