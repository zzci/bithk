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
import { addMember } from "@/modules/project/project.service";
import { projectRoles } from "@/modules/project/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import {
  createGlobalTemplate,
  createShipTemplate,
  deleteGlobalTemplate,
  getGlobalTemplate,
  getShipTemplate,
  listGlobalTemplates,
  maintenanceTemplateRoutes,
  updateGlobalTemplate,
} from "./ship.maintenance-template.service";
import { shipRoutes } from "./ship.routes";
import { createShip, getShipByShortId } from "./ship.service";
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
  app.route("/", maintenanceTemplateRoutes());
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

async function createShipAsAdmin(app: Hono<AppEnv>, name = "Aurora"): Promise<{ adminCookie: string; shipShortId: string; baseProjectInternalId: string }> {
  const admin = await sessionFor("admin");
  const res = await app.request("/ships", jsonReq("POST", admin.cookie, { name }));
  expect(res.status).toBe(201);
  const body = await res.json() as { data: { id: string } };
  const ship = await getShipByShortId(db, body.data.id);
  return { adminCookie: admin.cookie, shipShortId: body.data.id, baseProjectInternalId: ship!.baseProjectId! };
}

interface TemplateBody { id: string; name: string; category: string | null; checklist: string | null; precautions: string | null }

async function dataOf<T>(r: Response): Promise<T> {
  return (await r.json() as { data: T }).data;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-maint-${Date.now()}-${nanoid()}`);
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

describe("global maintenance-template KB (admin only)", () => {
  test("non-admin is rejected with 403 on every verb", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("user");
    expect((await app.request("/maintenance-templates", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await app.request("/maintenance-templates", jsonReq("POST", cookie, { name: "X" }))).status).toBe(403);
    expect((await app.request("/maintenance-templates/x", { headers: { Cookie: cookie } })).status).toBe(403);
  });

  test("unauthenticated is rejected with 401", async () => {
    const res = await buildApp(db).request("/maintenance-templates");
    expect(res.status).toBe(401);
  });

  test("admin performs full CRUD", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    const created = await app.request("/maintenance-templates", jsonReq("POST", admin.cookie, {
      name: "Engine service",
      category: "engine",
      checklist: "oil; filter",
      precautions: "cool down first",
    }));
    expect(created.status).toBe(201);
    const tpl = await dataOf<TemplateBody>(created);
    expect(tpl.name).toBe("Engine service");

    const list = await app.request("/maintenance-templates", { headers: { Cookie: admin.cookie } });
    expect((await dataOf<TemplateBody[]>(list))).toHaveLength(1);

    const got = await app.request(`/maintenance-templates/${tpl.id}`, { headers: { Cookie: admin.cookie } });
    expect(got.status).toBe(200);

    const patched = await app.request(`/maintenance-templates/${tpl.id}`, jsonReq("PATCH", admin.cookie, { name: "Engine A" }));
    expect((await dataOf<TemplateBody>(patched)).name).toBe("Engine A");

    const del = await app.request(`/maintenance-templates/${tpl.id}`, jsonReq("DELETE", admin.cookie));
    expect(del.status).toBe(200);
    expect((await app.request(`/maintenance-templates/${tpl.id}`, { headers: { Cookie: admin.cookie } })).status).toBe(404);
  });

  test("rejects an empty name with 422", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const res = await app.request("/maintenance-templates", jsonReq("POST", admin.cookie, { name: "" }));
    expect(res.status).toBe(422);
  });
});

describe("ship-level templates: isolation from the global KB", () => {
  test("ship list returns ONLY this ship's templates, never globals", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    // Seed a global template (admin) — it must not appear in the ship list.
    await app.request("/maintenance-templates", jsonReq("POST", adminCookie, { name: "Global one" }));

    const before = await app.request(`/ships/${shipShortId}/maintenance-templates`, { headers: { Cookie: adminCookie } });
    expect(await dataOf<TemplateBody[]>(before)).toHaveLength(0);

    await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", adminCookie, { name: "Ship local" }));
    const after = await dataOf<TemplateBody[]>(await app.request(`/ships/${shipShortId}/maintenance-templates`, { headers: { Cookie: adminCookie } }));
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe("Ship local");
  });

  test("copy-from-global produces an independent row; later global edits do not affect it", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const global = await dataOf<TemplateBody>(await app.request("/maintenance-templates", jsonReq("POST", adminCookie, {
      name: "Hull check",
      category: "hull",
      checklist: "step 1; step 2",
      precautions: "dry dock",
    })));

    const copied = await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", adminCookie, { fromGlobalId: global.id }));
    expect(copied.status).toBe(201);
    const copy = await dataOf<TemplateBody>(copied);
    expect(copy.name).toBe("Hull check");
    expect(copy.checklist).toBe("step 1; step 2");
    expect(copy.id).not.toBe(global.id); // a new, independent row

    // Edit the global afterwards.
    await app.request(`/maintenance-templates/${global.id}`, jsonReq("PATCH", adminCookie, { checklist: "REWRITTEN" }));

    // The ship copy is unchanged.
    const reread = await dataOf<TemplateBody>(await app.request(`/ships/${shipShortId}/maintenance-templates/${copy.id}`, { headers: { Cookie: adminCookie } }));
    expect(reread.checklist).toBe("step 1; step 2");
  });

  test("copy from a non-existent global id → 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", adminCookie, { fromGlobalId: "missing1" }));
    expect(res.status).toBe(404);
  });

  test("create from scratch without a name → 422", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", adminCookie, { category: "x" }));
    expect(res.status).toBe(422);
  });

  // B5 regression: fromGlobalId snapshots the global row wholesale, so combining
  // it with explicit content fields is contradictory and rejected (422).
  test("rejects fromGlobalId combined with content fields → 422 (B5)", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const global = await dataOf<TemplateBody>(await app.request("/maintenance-templates", jsonReq("POST", adminCookie, { name: "Src" })));
    const res = await app.request(
      `/ships/${shipShortId}/maintenance-templates`,
      jsonReq("POST", adminCookie, { fromGlobalId: global.id, name: "Override" }),
    );
    expect(res.status).toBe(422);
  });
});

// T6: the global-knowledge-base getters guard on `isNull(shipId)`, so a
// ship-level template (shipId set) is never reachable through the global API.
describe("global template getters: isNull(shipId) guard", () => {
  test("global getters never see ship-level rows, and vice versa", async () => {
    const creator = await seedUser("admin");
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });

    const shipLevel = await createShipTemplate(db, ship.id, { name: "Ship local", category: "engine" });
    expect(shipLevel.status).toBe("ok");
    const shipTemplateId = shipLevel.status === "ok" ? shipLevel.template.id : "";

    const global = await createGlobalTemplate(db, { name: "Global one" });

    // listGlobalTemplates returns ONLY the global row.
    const globals = await listGlobalTemplates(db);
    expect(globals).toHaveLength(1);
    expect(globals[0]!.id).toBe(global.id);

    // getGlobalTemplate refuses a ship-level id but resolves a true global id.
    expect(await getGlobalTemplate(db, shipTemplateId)).toBeUndefined();
    expect(await getGlobalTemplate(db, global.id)).toBeDefined();

    // updateGlobalTemplate / deleteGlobalTemplate are no-ops on a ship-level id.
    expect(await updateGlobalTemplate(db, shipTemplateId, { name: "Hijack" })).toBeUndefined();
    expect(await deleteGlobalTemplate(db, shipTemplateId)).toBe(false);

    // The ship-level row survives untouched.
    const survivor = await getShipTemplate(db, ship.id, shipTemplateId);
    expect(survivor?.name).toBe("Ship local");
  });
});

describe("ship-level templates: authz", () => {
  test("member reads, project.manage writes, non-member gets 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // Admin (PM) creates a template to read.
    const tpl = await dataOf<TemplateBody>(await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", adminCookie, { name: "T" })));

    // Plain member: can read, cannot write (403).
    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memberCookie = await cookieForUser(member);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates`, { headers: { Cookie: memberCookie } })).status).toBe(200);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", memberCookie, { name: "Nope" }))).status).toBe(403);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates/${tpl.id}`, jsonReq("PATCH", memberCookie, { name: "Nope" }))).status).toBe(403);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates/${tpl.id}`, jsonReq("DELETE", memberCookie))).status).toBe(403);

    // Non-member: fail-closed 404 on read and write.
    const outsider = await sessionFor("user");
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates`, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates`, jsonReq("POST", outsider.cookie, { name: "Nope" }))).status).toBe(404);

    // PM (admin) writes successfully.
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates/${tpl.id}`, jsonReq("PATCH", adminCookie, { name: "Renamed" }))).status).toBe(200);
    expect((await app.request(`/ships/${shipShortId}/maintenance-templates/${tpl.id}`, jsonReq("DELETE", adminCookie))).status).toBe(200);
  });
});
