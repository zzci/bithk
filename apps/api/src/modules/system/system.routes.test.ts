import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { BUILD_INFO } from "@/build-info";
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
const originalLodeEnv = {
  LODE_CONFIG: process.env.LODE_CONFIG,
  LODE_CONFIG_FILE: process.env.LODE_CONFIG_FILE,
  LODE_DATA_DIR: process.env.LODE_DATA_DIR,
  LODE_INSTANCE: process.env.LODE_INSTANCE,
};

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
  clearLodeEnv();
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
  restoreLodeEnv();
});

function clearLodeEnv() {
  delete process.env.LODE_CONFIG;
  delete process.env.LODE_CONFIG_FILE;
  delete process.env.LODE_DATA_DIR;
  delete process.env.LODE_INSTANCE;
}

function restoreLodeEnv() {
  for (const [key, value] of Object.entries(originalLodeEnv)) {
    if (value === undefined)
      delete process.env[key];
    else
      process.env[key] = value;
  }
}

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
    const body = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.version).toBe(BUILD_INFO.version);
    expect(body.data.commit).toBe(BUILD_INFO.commit);
    expect(body.data.buildTime).toBe(BUILD_INFO.buildTime);
  });

  test("returns an inactive lode summary when lode env is missing", async () => {
    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: Record<string, unknown> } };
    expect(body.data.lode).toEqual({
      configured: false,
      active: false,
      status: "not_configured",
      readiness: { ready: null, phase: null },
      update: { configStatus: "not_configured" },
      manualOperations: { check: false, apply: false },
    });
  });

  test("returns a safe lode summary from state and config", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DATA_DIR = lodeDir;
    process.env.LODE_INSTANCE = "instance-1";
    writeFileSync(join(lodeDir, "state.json"), JSON.stringify({
      current: "0.1.5",
      status: "running",
      ready: "instance-1",
      secretToken: "do-not-return",
    }));
    writeFileSync(join(lodeDir, "lode.toml"), `
[update]
github = "zzci/bithk"
asset = "bit-linux-x64.tar.gz"
channel = "stable"
policy = "auto"
headers = { authorization = "Bearer do-not-return" }

[trust]
trusted_keys = ["trusted-key-material"]
`);

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: unknown } };
    expect(body.data.lode).toEqual({
      configured: true,
      active: true,
      status: "available",
      current: "0.1.5",
      stateStatus: "running",
      readiness: { ready: true, phase: 0 },
      update: {
        configStatus: "available",
        policy: "auto",
        channel: "stable",
        asset: "bit-linux-x64.tar.gz",
        sourceType: "github",
        source: "zzci/bithk",
      },
      manualOperations: { check: false, apply: false },
    });
  });

  test("handles malformed lode state without failing the route", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DATA_DIR = lodeDir;
    process.env.LODE_INSTANCE = "instance-1";
    writeFileSync(join(lodeDir, "state.json"), "{not-json");

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: { status: string; readiness: { ready: boolean | null } } } };
    expect(body.data.lode.status).toBe("state_malformed");
    expect(body.data.lode.readiness.ready).toBeNull();
  });

  test("does not expose sensitive lode fields or filesystem paths", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DATA_DIR = lodeDir;
    process.env.LODE_INSTANCE = "instance-1";
    writeFileSync(join(lodeDir, "state.json"), JSON.stringify({
      current: "0.1.5",
      status: "running",
      ready: "instance-1",
      dataDir: lodeDir,
      authHeader: "Bearer secret-token",
    }));
    writeFileSync(join(lodeDir, "lode.toml"), `
[update]
manifest = "https://user:secret-token@example.com/releases/manifest.json?token=secret-token"
asset = "/srv/lode/private.tar.gz"
channel = "stable"
policy = "check"

[trust]
trusted_keys = ["trusted-key-material"]
`);

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);
    expect(json).not.toContain(lodeDir);
    expect(json).not.toContain("instance-1");
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("trusted-key-material");
    expect(json).not.toContain("authHeader");
    expect(json).not.toContain("private.tar.gz");
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
