import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv, User } from "@/shared/lib/types";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { BUILD_INFO } from "@/build-info";
import { createDb } from "@/db";
import { listAuditEvents } from "@/modules/audit/audit.service";
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

const adminUser = { id: "a", name: "Admin", role: "admin" } as User;
const normalUser = { id: "u", name: "User", role: "user" } as User;

interface AppOpts {
  db?: unknown;
  cfg?: Config;
  user?: User;
}

let db: AppDatabase;
let dbPath: string;
const originalLodeEnv = {
  LODE_DIR: process.env.LODE_DIR,
  LODE_INSTANCE: process.env.LODE_INSTANCE,
  LODE_ACTIVE_VERSION: process.env.LODE_ACTIVE_VERSION,
  LODE_READINESS: process.env.LODE_READINESS,
  LODE_CONFIG: process.env.LODE_CONFIG,
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
  delete process.env.LODE_DIR;
  delete process.env.LODE_INSTANCE;
  delete process.env.LODE_ACTIVE_VERSION;
  delete process.env.LODE_READINESS;
  delete process.env.LODE_CONFIG;
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

  test("returns an unsupervised lode summary when lode env is missing", async () => {
    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: Record<string, unknown> } };
    expect(body.data.lode).toEqual({
      supervised: false,
      active: false,
      stateAvailable: false,
      ready: null,
      hold: false,
      configChanged: false,
      history: [],
      updateAvailable: false,
      config: { status: "not_configured" },
    });
  });

  test("maps lode state.json into the summary", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DIR = lodeDir;
    process.env.LODE_INSTANCE = "instance-1";
    writeFileSync(join(lodeDir, "state.json"), JSON.stringify({
      current: "0.1.5",
      last_good: "0.1.4",
      available: "0.1.6",
      channel: "stable",
      status: "running",
      ready: "instance-1-0",
      hold: false,
      history: [{ version: "0.1.5", at: "2026-06-24T00:00:00Z", result: "good" }],
    }));

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: unknown } };
    expect(body.data.lode).toEqual({
      supervised: true,
      active: true,
      stateAvailable: true,
      status: "running",
      current: "0.1.5",
      lastGood: "0.1.4",
      available: "0.1.6",
      channel: "stable",
      ready: true,
      hold: false,
      configGeneration: 0,
      configChanged: false,
      history: [{ version: "0.1.5", at: "2026-06-24T00:00:00Z", result: "good" }],
      updateAvailable: true,
      rollbackTarget: "0.1.4",
      config: { status: "not_configured" },
    });
  });

  test("surfaces safe update config from lode.toml and redacts secrets", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DIR = lodeDir;
    const cfg = join(lodeDir, "lode.toml");
    writeFileSync(cfg, `
[update]
github = "zzci/bithk"
asset = "bit-linux-x64.tar.gz"
channel = "stable"
policy = "auto"
headers = { authorization = "Bearer SECRET" }

[trust]
trusted_keys = ["trusted-key-material"]
`);
    process.env.LODE_CONFIG = cfg;

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lode: { config?: unknown } } };
    expect(body.data.lode.config).toEqual({
      status: "available",
      sourceType: "github",
      source: "zzci/bithk",
      asset: "bit-linux-x64.tar.gz",
      channel: "stable",
      policy: "auto",
    });
    const json = JSON.stringify(body);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("trusted-key-material");
  });

  test("does not expose sensitive lode fields or the instance token", async () => {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DIR = lodeDir;
    process.env.LODE_INSTANCE = "instance-1";
    writeFileSync(join(lodeDir, "state.json"), JSON.stringify({
      current: "0.1.5",
      status: "running",
      ready: "instance-1-0",
      secretToken: "do-not-return",
      authHeader: "Bearer secret-token",
    }));

    const res = await buildApp({ user: adminUser }).request("/system/version");
    expect(res.status).toBe(200);
    const json = JSON.stringify(await res.json());
    // The summary maps only known fields, so unknown state.json keys (and the
    // raw `ready` instance token) never reach the response.
    expect(json).not.toContain("instance-1");
    expect(json).not.toContain("secretToken");
    expect(json).not.toContain("do-not-return");
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("authHeader");
  });
});

describe("lode operator endpoints", () => {
  function writeLodeState(state: Record<string, unknown> = {}): string {
    const lodeDir = resolve(dbPath, "../lode");
    mkdirSync(lodeDir, { recursive: true });
    process.env.LODE_DIR = lodeDir;
    writeFileSync(join(lodeDir, "state.json"), JSON.stringify(state));
    return lodeDir;
  }
  function readLodeState(lodeDir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(lodeDir, "state.json"), "utf-8")) as Record<string, unknown>;
  }
  function post(path: string, opts: AppOpts, body?: unknown) {
    return buildApp(opts).request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  test("401 when anonymous, 403 for a non-admin", async () => {
    expect((await post("/system/lode/restart", {})).status).toBe(401);
    expect((await post("/system/lode/restart", { user: normalUser })).status).toBe(403);
  });

  test("409 when not running under lode", async () => {
    const res = await post("/system/lode/restart", { user: adminUser });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("LODE_NOT_ACTIVE");
  });

  test("restart bumps restart_nonce and records an audit event", async () => {
    const lodeDir = writeLodeState({ restart_nonce: 2, current: "0.1.5" });
    const res = await post("/system/lode/restart", { user: adminUser });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { status: "ok", restartNonce: 3 } });
    expect(readLodeState(lodeDir).restart_nonce).toBe(3);
    const audit = await listAuditEvents(db, { resourceType: "lode" });
    expect(audit.total).toBe(1);
    expect(audit.data[0]?.action).toBe("lode.restart");
  });

  test("update sets the target version", async () => {
    const lodeDir = writeLodeState({});
    const res = await post("/system/lode/update", { user: adminUser }, { target: "latest" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { status: "ok", target: "latest" } });
    expect(readLodeState(lodeDir).target).toBe("latest");
  });

  test("update rejects an invalid target with 422", async () => {
    writeLodeState({});
    const res = await post("/system/lode/update", { user: adminUser }, { target: "bad target!" });
    expect(res.status).toBe(422);
  });

  test("rollback uses last_good, and 409s when none is recorded", async () => {
    const lodeDir = writeLodeState({ current: "0.1.6", last_good: "0.1.5" });
    const ok = await post("/system/lode/rollback", { user: adminUser }, {});
    expect(ok.status).toBe(200);
    expect(readLodeState(lodeDir).target).toBe("0.1.5");

    writeLodeState({ current: "0.1.6" });
    const missing = await post("/system/lode/rollback", { user: adminUser }, {});
    expect(missing.status).toBe(409);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe("LODE_NO_ROLLBACK_TARGET");
  });

  test("hold sets and clears the maintenance hold", async () => {
    const lodeDir = writeLodeState({});
    const set = await post("/system/lode/hold", { user: adminUser }, { hold: true });
    expect(set.status).toBe(200);
    expect(readLodeState(lodeDir).hold).toBe(true);
    const clear = await post("/system/lode/hold", { user: adminUser }, { hold: false });
    expect(clear.status).toBe(200);
    expect(readLodeState(lodeDir).hold).toBe(false);
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
