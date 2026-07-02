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
import { authRoutes } from "./auth.routes";
import { __resetSingleUserLockoutForTests, isSingleUserLocked } from "./lockout.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

function baseConfig(overrides: Partial<Config> = {}): Config {
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
    HTTP_LOG_LEVEL: "info",
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
    BACKUP_STAGING_TTL_HOURS: 24,
    BACKUP_IMPORT_MAX_ARCHIVE_BYTES: 2 * 1024 * 1024 * 1024,
    BACKUP_IMPORT_MAX_BLOB_BYTES: 256 * 1024 * 1024,
    ...overrides,
  };
}

function buildApp(db: AppDatabase, config: Config): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", config);
    c.set("logger", stubLogger);
    await next();
  });
  app.route("/", authRoutes());
  return app;
}

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-auth-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  await __resetSingleUserLockoutForTests(db);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("GET /account/auth/mode", () => {
  test("reports oauth mode when single-user is off", async () => {
    const app = buildApp(db, baseConfig());
    const res = await app.request("/account/auth/mode");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { mode: string; oauthConfigured: boolean } };
    expect(body.data.mode).toBe("oauth");
    expect(body.data.oauthConfigured).toBe(false);
  });

  test("reports single-user mode when enabled", async () => {
    const hash = await Bun.password.hash("hunter22", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/mode");
    const body = await res.json() as { data: { mode: string } };
    expect(body.data.mode).toBe("single-user");
  });
});

describe("POST /account/auth/login-local", () => {
  test("404s when single-user mode is disabled", async () => {
    const app = buildApp(db, baseConfig());
    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x", password: "y" }),
    });
    expect(res.status).toBe(404);
  });

  test("401s on wrong password", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "nope" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("401s on unknown username (same code as wrong password)", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "intruder", password: "correct-horse" }),
    });
    expect(res.status).toBe(401);
  });

  test("succeeds, creates an admin user, and sets the session cookie", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "OWNER", password: "correct-horse" }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session_id=");

    const row = await db.select().from(users).where(eq(users.oauthSub, "single-user")).get();
    expect(row?.role).toBe("admin");
    expect(row?.username).toBe("owner");
  });

  test("rejects malformed json with 400", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("locks the account after 10 consecutive failures and returns 429", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/account/auth/login-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "owner", password: `wrong-${i}` }),
      });
      expect(res.status).toBe(401);
    }

    const locked = await isSingleUserLocked(db, "owner");
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);

    const res = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "correct-horse" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("ACCOUNT_LOCKED");
  });

  test("does not let an attacker probe past the lock by varying the submitted username", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));

    for (let i = 0; i < 10; i++) {
      await app.request("/account/auth/login-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `attacker-${i}`, password: "wrong" }),
      });
    }
    expect((await isSingleUserLocked(db, "owner")).locked).toBe(true);
  });

  test("clears failure counter on successful login", async () => {
    const hash = await Bun.password.hash("correct-horse", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));

    for (let i = 0; i < 5; i++) {
      await app.request("/account/auth/login-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "owner", password: "wrong" }),
      });
    }
    const ok = await app.request("/account/auth/login-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "correct-horse" }),
    });
    expect(ok.status).toBe(200);
    expect((await isSingleUserLocked(db, "owner")).locked).toBe(false);
  });
});

describe("GET /account/auth/login", () => {
  test("redirects with single_user_mode_active when single-user mode is on", async () => {
    const hash = await Bun.password.hash("hunter22", { algorithm: "argon2id" });
    const app = buildApp(db, baseConfig({
      SINGLE_USER_MODE: true,
      SINGLE_USER_USERNAME: "owner",
      SINGLE_USER_PASSWORD_HASH: hash,
    }));
    const res = await app.request("/account/auth/login");
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/error");
    expect(location).toContain("code=single_user_mode_active");
  });

  test("exempts loopback peers from the per-IP rate limiter", async () => {
    const app = buildApp(db, baseConfig());
    // AUTH_RATE_MAX is 120/window; 130 calls from a non-loopback IP would 429
    // partway through. A loopback peer is exempt, so every call clears the
    // limiter (here a 302 to oauth_not_configured, OAuth being unset).
    const env = { IP: { address: "127.0.0.1", port: 0, family: "IPv4" as const } };
    let last = await app.request("/account/auth/login", {}, env);
    for (let i = 0; i < 130; i++)
      last = await app.request("/account/auth/login", {}, env);
    expect(last.status).toBe(302);
  });

  test("still rate-limits a loopback peer in production when TRUST_PROXY=false", async () => {
    // Regression for AUDIT-20260701 P2 / FIX-049: a same-host reverse proxy
    // connecting over loopback under the default TRUST_PROXY=false must NOT
    // silently disable the per-IP limiter. In production the loopback exemption
    // is withheld, so repeated /login from 127.0.0.1 trips the 120/window cap.
    const app = buildApp(db, baseConfig({ NODE_ENV: "production", TRUST_PROXY: false }));
    const env = { IP: { address: "127.0.0.1", port: 0, family: "IPv4" as const } };
    const statuses: number[] = [];
    for (let i = 0; i < 130; i++) {
      const res = await app.request("/account/auth/login", {}, env);
      statuses.push(res.status);
    }
    // First requests pass (302 to oauth_not_configured), then the limiter trips.
    expect(statuses[0]).toBe(302);
    expect(statuses.includes(429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test("keeps the loopback exemption in production when TRUST_PROXY=true", async () => {
    // With TRUST_PROXY=true getClientIp resolves the real end-user IP, so a
    // loopback result means a genuine direct on-host caller — still exempt, so
    // the fix does not throttle legitimate trusted-proxy loopback traffic.
    const app = buildApp(db, baseConfig({ NODE_ENV: "production", TRUST_PROXY: true }));
    const env = { IP: { address: "127.0.0.1", port: 0, family: "IPv4" as const } };
    let last = await app.request("/account/auth/login", {}, env);
    for (let i = 0; i < 130; i++)
      last = await app.request("/account/auth/login", {}, env);
    expect(last.status).toBe(302);
  });
});

describe("GET /account/auth/callback", () => {
  test("clears the production OAuth state cookie with Secure", async () => {
    const app = buildApp(db, baseConfig({
      NODE_ENV: "production",
      BASE_PATH: "/bit",
      OAUTH_CLIENT_ID: "client",
      OAUTH_CLIENT_SECRET: "secret",
      OAUTH_AUTHORIZE_URL: "https://idp.example.com/auth",
      OAUTH_TOKEN_URL: "https://idp.example.com/token",
      OAUTH_USERINFO_URL: "https://idp.example.com/userinfo",
    }));

    const res = await app.request("/account/auth/callback?code=code&state=state", {
      headers: { cookie: "__Secure-oauth_state=state" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/bit/error?code=oauth_state_invalid");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Secure-oauth_state=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/bit");
    expect(setCookie).toContain("Secure");
  });
});
