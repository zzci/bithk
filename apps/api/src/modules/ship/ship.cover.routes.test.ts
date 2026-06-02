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
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { __resetFilePermissionHooksForTests } from "@/modules/file/permission";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { addMember } from "@/modules/project/project.service";
import { projectRoles } from "@/modules/project/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { shipRoutes } from "./ship.routes";
import { getShipByShortId } from "./ship.service";
// Registers the session-cookie auth provider that `authRequired` resolves through.
import "@/modules/account";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against magic
// bytes, so a forged payload would be rejected before it is stored.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

function testConfig(): Config {
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
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_GC_MODE: "sync",
    FILE_PRESIGN_ENABLED: false,
    FILE_PRESIGN_TTL_SECONDS: 300,
  } as unknown as Config;
}

function buildApp(db: AppDatabase): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", testConfig());
    c.set("logger", stubLogger);
    await next();
  });
  app.route("/", shipRoutes());
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

async function sessionFor(role: "admin" | "user" = "user"): Promise<{ userId: string; cookie: string }> {
  const userId = await seedUser(role);
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return { userId, cookie: `session_id=${sessionId}` };
}

async function cookieForUser(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

async function memberRoleId(projectInternalId: string): Promise<string> {
  const roles = await db.select().from(projectRoles).where(eq(projectRoles.projectId, projectInternalId)).all();
  return roles.find(r => r.name === "Reader")!.id;
}

/** Build a multipart cover-image request; omit `file` for the no-file path. */
function coverReq(cookie: string, file?: File): RequestInit {
  const fd = new FormData();
  if (file)
    fd.append("file", file);
  // Content-Type (multipart boundary) is set automatically for a FormData body.
  return { method: "POST", headers: { Cookie: cookie }, body: fd };
}

async function createShipAsAdmin(app: Hono<AppEnv>): Promise<{ adminCookie: string; shipShortId: string; baseProjectInternalId: string }> {
  const admin = await sessionFor("admin");
  const res = await app.request("/ships", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": admin.cookie },
    body: JSON.stringify({ name: "Aurora" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json() as { data: { id: string } };
  const ship = await getShipByShortId(db, body.data.id);
  return { adminCookie: admin.cookie, shipShortId: body.data.id, baseProjectInternalId: ship!.baseProjectId! };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-cover-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __resetFilePermissionHooksForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("POST /ships/:shortId/cover-image", () => {
  test("a manager uploads a PNG → 200 and the view exposes coverImageUrl", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const file = new File([PNG_1X1], "cover.png", { type: "image/png" });
    const res = await app.request(`/ships/${shipShortId}/cover-image`, coverReq(adminCookie, file));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { coverImageUrl: string | null } };
    expect(body.data.coverImageUrl).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);
  });

  test("no file in the form → 400 VALIDATION_ERROR", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const res = await app.request(`/ships/${shipShortId}/cover-image`, coverReq(adminCookie));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  test("a non-image file → 400 INVALID_MIMETYPE", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const file = new File(["not an image"], "note.txt", { type: "text/plain" });
    const res = await app.request(`/ships/${shipShortId}/cover-image`, coverReq(adminCookie, file));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_MIMETYPE");
  });

  test("a plain member (no project.manage) → 403", async () => {
    const app = buildApp(db);
    const { shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });

    const file = new File([PNG_1X1], "cover.png", { type: "image/png" });
    const res = await app.request(`/ships/${shipShortId}/cover-image`, coverReq(await cookieForUser(member), file));
    expect(res.status).toBe(403);
  });

  test("a non-member → fail-closed 404 (existence is not leaked)", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);

    const outsider = await sessionFor("user");
    const file = new File([PNG_1X1], "cover.png", { type: "image/png" });
    const res = await app.request(`/ships/${shipShortId}/cover-image`, coverReq(outsider.cookie, file));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /ships/:shortId/cover-image", () => {
  test("a manager removes the cover → 200 and coverImageUrl is cleared", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const file = new File([PNG_1X1], "cover.png", { type: "image/png" });
    expect((await app.request(`/ships/${shipShortId}/cover-image`, coverReq(adminCookie, file))).status).toBe(200);

    const res = await app.request(`/ships/${shipShortId}/cover-image`, { method: "DELETE", headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { coverImageUrl: string | null } };
    expect(body.data.coverImageUrl).toBeNull();
  });

  test("a plain member → 403; a non-member → 404", async () => {
    const app = buildApp(db);
    const { shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    expect((await app.request(`/ships/${shipShortId}/cover-image`, { method: "DELETE", headers: { Cookie: await cookieForUser(member) } })).status).toBe(403);

    const outsider = await sessionFor("user");
    expect((await app.request(`/ships/${shipShortId}/cover-image`, { method: "DELETE", headers: { Cookie: outsider.cookie } })).status).toBe(404);
  });
});
