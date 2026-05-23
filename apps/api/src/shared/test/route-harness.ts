import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";

/**
 * Shared HTTP route-test harness for the backup / cron / audit / settings /
 * search modules. Centralises the boilerplate that route integration tests
 * need (a full `Config`, a no-op logger, a mounted Hono app with `db` /
 * `config` / `logger` seeded into context, plus user + session seeding) so
 * each suite stays focused on the behaviour it exercises rather than copying
 * an 80-line fixture. Test-only: never imported by production code.
 */

export const testNanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = {
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
  };
  return { ...base, ...overrides } as unknown as Config;
}

/**
 * Build a Hono app that seeds `db` / `config` / `logger` into context, mounts
 * the supplied router factories at `/`, and wires the shared error handler.
 */
export function mountRoutes(
  db: AppDatabase,
  routers: ReadonlyArray<() => Hono<AppEnv>>,
  config: Config = testConfig(),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", config);
    c.set("logger", stubLogger);
    await next();
  });
  for (const router of routers)
    app.route("/", router());
  app.onError(errorHandler);
  return app;
}

export async function seedUser(db: AppDatabase, role: "admin" | "user"): Promise<string> {
  const id = testNanoid();
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

/** Seed a user + a live session and return the Cookie header for it. */
export async function sessionCookieFor(
  db: AppDatabase,
  role: "admin" | "user",
): Promise<{ userId: string; cookie: string }> {
  const userId = await seedUser(db, role);
  const sessionId = await createSession(db, userId, "test-access-token", undefined, 3600);
  return { userId, cookie: `session_id=${sessionId}` };
}
