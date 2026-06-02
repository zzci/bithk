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
import { addMember, createProject } from "@/modules/project/project.service";
import { projectRoles } from "@/modules/project/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { shipRoutes } from "./ship.routes";
import { getShipByShortId } from "./ship.service";
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

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** Create a ship through the route as an admin; return its short id + the admin session. */
async function createShipAsAdmin(app: Hono<AppEnv>, name = "Aurora"): Promise<{ adminId: string; adminCookie: string; shipShortId: string; baseProjectInternalId: string }> {
  const admin = await sessionFor("admin");
  const res = await app.request("/ships", jsonReq("POST", admin.cookie, { name }));
  expect(res.status).toBe(201);
  const body = await res.json() as { data: { id: string } };
  const ship = await getShipByShortId(db, body.data.id);
  return { adminId: admin.userId, adminCookie: admin.cookie, shipShortId: body.data.id, baseProjectInternalId: ship!.baseProjectId! };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-routes-${Date.now()}-${nanoid()}`);
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

describe("auth gating", () => {
  test("GET /ships → 401 without a session", async () => {
    const res = await buildApp(db).request("/ships");
    expect(res.status).toBe(401);
  });

  test("POST /ships → 403 for a non-admin user", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("user");
    const res = await app.request("/ships", jsonReq("POST", cookie, { name: "P" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /ships (admin only)", () => {
  test("admin creates a ship; the response carries the base project short id", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const res = await app.request("/ships", jsonReq("POST", admin.cookie, { name: "Bridge", code: "HULL-9" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; code: string; baseProjectId: string | null } };
    expect(body.data.code).toBe("HULL-9");
    expect(body.data.baseProjectId).not.toBeNull();

    // The creator can read it as the base project's PM.
    const detail = await app.request(`/ships/${body.data.id}`, { headers: { Cookie: await cookieForUser(admin.userId) } });
    expect(detail.status).toBe(200);
  });

  test("rejects an empty name with 422", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    const res = await app.request("/ships", jsonReq("POST", cookie, { name: "" }));
    expect(res.status).toBe(422);
  });
});

describe("GET /ships/:shortId (fail-closed read)", () => {
  test("non-member gets 404 (existence is not leaked); member and admin get 200", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // Outsider: fail-closed 404.
    const outsider = await sessionFor("user");
    const outRes = await app.request(`/ships/${shipShortId}`, { headers: { Cookie: outsider.cookie } });
    expect(outRes.status).toBe(404);

    // Add a member to the base project → can read.
    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memRes = await app.request(`/ships/${shipShortId}`, { headers: { Cookie: await cookieForUser(member) } });
    expect(memRes.status).toBe(200);

    // Admin (also the creator here) reads fine.
    const admRes = await app.request(`/ships/${shipShortId}`, { headers: { Cookie: adminCookie } });
    expect(admRes.status).toBe(200);
  });

  test("unknown ship → 404", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const res = await app.request("/ships/nope1234", { headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(404);
  });
});

describe("GET /ships (list is member-scoped for non-admins)", () => {
  test("a non-admin sees only ships whose base project they belong to", async () => {
    const app = buildApp(db);
    const a = await createShipAsAdmin(app, "ShipA");
    await createShipAsAdmin(app, "ShipB");

    // A plain user, member of ShipA's base project only.
    const member = await seedUser("user");
    await addMember(db, a.baseProjectInternalId, { roleId: await memberRoleId(a.baseProjectInternalId), userId: member });

    const listRes = await app.request("/ships", { headers: { Cookie: await cookieForUser(member) } });
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as { data: { id: string }[]; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe(a.shipShortId);
  });
});

describe("PATCH /ships/:shortId (write needs project.manage)", () => {
  test("a plain member gets 403; the PM updates; a non-member gets 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // Plain member (no project.manage) → 403.
    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memRes = await app.request(`/ships/${shipShortId}`, jsonReq("PATCH", await cookieForUser(member), { name: "X" }));
    expect(memRes.status).toBe(403);

    // Non-member → fail-closed 404.
    const outsider = await sessionFor("user");
    const outRes = await app.request(`/ships/${shipShortId}`, jsonReq("PATCH", outsider.cookie, { name: "X" }));
    expect(outRes.status).toBe(404);

    // PM (admin/creator) → 200.
    const pmRes = await app.request(`/ships/${shipShortId}`, jsonReq("PATCH", adminCookie, { name: "Renamed" }));
    expect(pmRes.status).toBe(200);
    expect((await pmRes.json() as { data: { name: string } }).data.name).toBe("Renamed");
  });
});

describe("DELETE /ships/:shortId (admin only)", () => {
  test("non-admin member gets 403; admin soft-deletes", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memRes = await app.request(`/ships/${shipShortId}`, jsonReq("DELETE", await cookieForUser(member)));
    expect(memRes.status).toBe(403);

    const delRes = await app.request(`/ships/${shipShortId}`, jsonReq("DELETE", adminCookie));
    expect(delRes.status).toBe(200);
    const after = await app.request(`/ships/${shipShortId}`, { headers: { Cookie: adminCookie } });
    expect(after.status).toBe(404);
  });
});

describe("binding routes", () => {
  test("PM binds/unbinds extra projects; base project is not unbindable", async () => {
    const app = buildApp(db);
    const { adminId, adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // List: only the base project, flagged isBase.
    const listRes = await app.request(`/ships/${shipShortId}/projects`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(200);
    const listed = await res(listRes);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]!.isBase).toBe(true);

    // Bind a standalone project (admin is its PM too).
    const extra = await createProject(db, { name: "Extra", creatorId: adminId });
    const bindRes = await app.request(`/ships/${shipShortId}/projects`, jsonReq("POST", adminCookie, { projectShortId: extra.shortId }));
    expect(bindRes.status).toBe(200);
    expect((await res(bindRes)).data).toHaveLength(2);

    // The base project cannot be unbound.
    const { projects } = await import("@/modules/project/schema");
    const base = await db.select().from(projects).where(eq(projects.id, baseProjectInternalId)).get();
    const baseUnbind = await app.request(`/ships/${shipShortId}/projects/${base!.shortId}`, jsonReq("DELETE", adminCookie));
    expect(baseUnbind.status).toBe(403);

    // The extra project can be unbound.
    const unbind = await app.request(`/ships/${shipShortId}/projects/${extra.shortId}`, jsonReq("DELETE", adminCookie));
    expect(unbind.status).toBe(200);
  });

  test("a non-member cannot list a ship's projects (404)", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);
    const outsider = await sessionFor("user");
    const res = await app.request(`/ships/${shipShortId}/projects`, { headers: { Cookie: outsider.cookie } });
    expect(res.status).toBe(404);
  });

  // T4: bind error mappings at the route layer.
  test("binding an unknown project → 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/ships/${shipShortId}/projects`, jsonReq("POST", adminCookie, { projectShortId: "nope1234" }));
    expect(res.status).toBe(404);
  });

  test("binding another ship's base project → 422 (is_base)", async () => {
    const app = buildApp(db);
    const a = await createShipAsAdmin(app, "ShipA");
    // A second ship owned by the same admin; its base project is off-limits.
    const bRes = await app.request("/ships", jsonReq("POST", a.adminCookie, { name: "ShipB" }));
    const bBody = await bRes.json() as { data: { baseProjectId: string } };
    const res = await app.request(`/ships/${a.shipShortId}/projects`, jsonReq("POST", a.adminCookie, { projectShortId: bBody.data.baseProjectId }));
    expect(res.status).toBe(422);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  // T4 / B1 regression: a project already bound to ANOTHER ship as an extra is
  // refused (mapped to a 422 ValidationError, never silently stolen).
  test("binding a project already bound to another ship → 422 (bound_elsewhere)", async () => {
    const app = buildApp(db);
    const a = await createShipAsAdmin(app, "ShipA");
    const b = await createShipAsAdmin(app, "ShipB");

    // Bind a standalone project to ship B first.
    const extra = await createProject(db, { name: "Refit", creatorId: a.adminId });
    expect((await app.request(`/ships/${b.shipShortId}/projects`, jsonReq("POST", b.adminCookie, { projectShortId: extra.shortId }))).status).toBe(200);

    // Ship A cannot steal it.
    const res = await app.request(`/ships/${a.shipShortId}/projects`, jsonReq("POST", a.adminCookie, { projectShortId: extra.shortId }));
    expect(res.status).toBe(422);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});

async function res(r: Response): Promise<{ data: { isBase: boolean }[] }> {
  return await r.json() as { data: { isBase: boolean }[] };
}
