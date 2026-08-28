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
// Registers the session-cookie auth provider that `authRequired` resolves through.
import "@/modules/account";
// Registers the three maritime sections (ship-profile / equipment / worklist).
import "./index";

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

interface CategoryView { id: string; nameZh: string; nameEn: string; code: string | null; description: string | null }

/**
 * Create a ship-preset project — the fold's replacement for `POST /ships`. The
 * creator is seeded as its owner, so `adminCookie` names the project manager
 * exactly as it did before.
 */
async function createShipAsAdmin(_app: Hono<AppEnv>, name = "Aurora"): Promise<{ adminId: string; adminCookie: string; shipShortId: string; baseProjectInternalId: string }> {
  const admin = await sessionFor("admin");
  const project = await createProject(db, { name, creatorId: admin.userId, preset: "ship" });
  return { adminId: admin.userId, adminCookie: admin.cookie, shipShortId: project.shortId, baseProjectInternalId: project.id };
}

async function dataOf<T>(r: Response): Promise<T> {
  return (await r.json() as { data: T }).data;
}

async function createCategory(app: Hono<AppEnv>, shipShortId: string, cookie: string, body: Record<string, unknown>): Promise<CategoryView> {
  const res = await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", cookie, body));
  expect(res.status).toBe(201);
  return dataOf<CategoryView>(res);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-equip-cat-${Date.now()}-${nanoid()}`);
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

describe("per-project equipment categories (section access)", () => {
  test("a new ship project copies the global template — empty when none is defined", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const list = await dataOf<CategoryView[]>(await app.request(`/projects/${shipShortId}/equipment-categories`, { headers: { Cookie: adminCookie } }));
    expect(list).toHaveLength(0);
  });

  test("project manager full CRUD round-trip", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    // Create.
    const created = await createCategory(app, shipShortId, adminCookie, { nameZh: "ZH Navigation", nameEn: "Navigation", code: "NAV", description: "Bridge nav gear" });
    expect(created.nameZh).toBe("ZH Navigation");
    expect(created.nameEn).toBe("Navigation");
    expect(created.code).toBe("NAV");
    expect(created.description).toBe("Bridge nav gear");

    // List.
    const list = await dataOf<CategoryView[]>(await app.request(`/projects/${shipShortId}/equipment-categories`, { headers: { Cookie: adminCookie } }));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);

    // Get :categoryId.
    const getRes = await app.request(`/projects/${shipShortId}/equipment-categories/${created.id}`, { headers: { Cookie: adminCookie } });
    expect(getRes.status).toBe(200);
    expect((await dataOf<CategoryView>(getRes)).nameEn).toBe("Navigation");

    // Patch.
    const patchRes = await app.request(`/projects/${shipShortId}/equipment-categories/${created.id}`, jsonReq("PATCH", adminCookie, { nameEn: "Nav Systems" }));
    expect(patchRes.status).toBe(200);
    expect((await dataOf<CategoryView>(patchRes)).nameEn).toBe("Nav Systems");

    // Delete → then 404.
    const delRes = await app.request(`/projects/${shipShortId}/equipment-categories/${created.id}`, jsonReq("DELETE", adminCookie));
    expect(delRes.status).toBe(200);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${created.id}`, { headers: { Cookie: adminCookie } })).status).toBe(404);
  });

  test("a project member can read but cannot write", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);
    const category = await createCategory(app, shipShortId, adminCookie, { nameZh: "ZH Propulsion", nameEn: "Propulsion" });

    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memberCookie = await cookieForUser(member);

    // Read: list + get succeed.
    expect((await app.request(`/projects/${shipShortId}/equipment-categories`, { headers: { Cookie: memberCookie } })).status).toBe(200);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, { headers: { Cookie: memberCookie } })).status).toBe(200);

    // Write: create / patch / delete all 403 (no project.manage).
    expect((await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", memberCookie, { nameZh: "x", nameEn: "x" }))).status).toBe(403);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, jsonReq("PATCH", memberCookie, { nameEn: "X" }))).status).toBe(403);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, jsonReq("DELETE", memberCookie))).status).toBe(403);
  });

  test("a non-member gets fail-closed 404 on read and write", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const category = await createCategory(app, shipShortId, adminCookie, { nameZh: "ZH Anchoring", nameEn: "Anchoring" });

    const outsider = await sessionFor("user");
    expect((await app.request(`/projects/${shipShortId}/equipment-categories`, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", outsider.cookie, { nameZh: "x", nameEn: "x" }))).status).toBe(404);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, jsonReq("PATCH", outsider.cookie, { nameEn: "X" }))).status).toBe(404);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, jsonReq("DELETE", outsider.cookie))).status).toBe(404);
  });

  test("GET category list → 401 without a session", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);
    expect((await app.request(`/projects/${shipShortId}/equipment-categories`)).status).toBe(401);
  });

  describe("tenant isolation", () => {
    test("a category of one project is not reachable under another (404)", async () => {
      const app = buildApp(db);
      const shipA = await createShipAsAdmin(app, "A");
      // Same admin owns both projects → isolates scoping from authz.
      const shipBShortId = (await createProject(db, { name: "B", creatorId: shipA.adminId, preset: "ship" })).shortId;

      const category = await createCategory(app, shipA.shipShortId, shipA.adminCookie, { nameZh: "ZH Navigation", nameEn: "Navigation" });

      // Cross-project access of project A's category id under project B → 404 on every verb.
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories/${category.id}`, { headers: { Cookie: shipA.adminCookie } })).status).toBe(404);
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories/${category.id}`, jsonReq("PATCH", shipA.adminCookie, { nameEn: "X" }))).status).toBe(404);
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories/${category.id}`, jsonReq("DELETE", shipA.adminCookie))).status).toBe(404);

      // Project B's own list never contains project A's category.
      const listB = await dataOf<CategoryView[]>(await app.request(`/projects/${shipBShortId}/equipment-categories`, { headers: { Cookie: shipA.adminCookie } }));
      expect(listB).toHaveLength(0);
    });

    test("a member of one project cannot touch another project's categories (404)", async () => {
      const app = buildApp(db);
      const shipA = await createShipAsAdmin(app, "A");
      const shipBShortId = (await createProject(db, { name: "B", creatorId: shipA.adminId, preset: "ship" })).shortId;
      const category = await createCategory(app, shipBShortId, shipA.adminCookie, { nameZh: "ZH Propulsion", nameEn: "Propulsion" });

      // A user who is a member of project A only.
      const userA = await seedUser("user");
      await addMember(db, shipA.baseProjectInternalId, { roleId: await memberRoleId(shipA.baseProjectInternalId), userId: userA });
      const cookieA = await cookieForUser(userA);

      expect((await app.request(`/projects/${shipBShortId}/equipment-categories`, { headers: { Cookie: cookieA } })).status).toBe(404);
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories/${category.id}`, { headers: { Cookie: cookieA } })).status).toBe(404);
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories`, jsonReq("POST", cookieA, { nameZh: "x", nameEn: "x" }))).status).toBe(404);
      expect((await app.request(`/projects/${shipBShortId}/equipment-categories/${category.id}`, jsonReq("DELETE", cookieA))).status).toBe(404);
    });

    test("the same name is allowed across different projects", async () => {
      const app = buildApp(db);
      const shipA = await createShipAsAdmin(app, "A");
      const shipBShortId = (await createProject(db, { name: "B", creatorId: shipA.adminId, preset: "ship" })).shortId;

      await createCategory(app, shipA.shipShortId, shipA.adminCookie, { nameZh: "ZH Navigation", nameEn: "Navigation" });
      // Same bilingual names on a different project → allowed (uniqueness is per-project).
      const onB = await app.request(`/projects/${shipBShortId}/equipment-categories`, jsonReq("POST", shipA.adminCookie, { nameZh: "ZH Navigation", nameEn: "Navigation" }));
      expect(onB.status).toBe(201);
    });
  });

  describe("validation", () => {
    test("blank / whitespace name rejected with 422", async () => {
      const app = buildApp(db);
      const { adminCookie, shipShortId } = await createShipAsAdmin(app);
      expect((await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", adminCookie, { nameZh: "   ", nameEn: "Steering" }))).status).toBe(422);
      expect((await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", adminCookie, { nameZh: "ZH Steering", nameEn: "" }))).status).toBe(422);
    });

    test("duplicate name_zh or name_en within a project rejected with 422", async () => {
      const app = buildApp(db);
      const { adminCookie, shipShortId } = await createShipAsAdmin(app);
      await createCategory(app, shipShortId, adminCookie, { nameZh: "ZH Main Engine", nameEn: "Main Engine" });

      const dupZh = await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", adminCookie, { nameZh: "ZH Main Engine", nameEn: "Different" }));
      expect(dupZh.status).toBe(422);
      const dupEn = await app.request(`/projects/${shipShortId}/equipment-categories`, jsonReq("POST", adminCookie, { nameZh: "ZH Different", nameEn: "Main Engine" }));
      expect(dupEn.status).toBe(422);
    });

    test("PATCH with no fields → 422", async () => {
      const app = buildApp(db);
      const { adminCookie, shipShortId } = await createShipAsAdmin(app);
      const category = await createCategory(app, shipShortId, adminCookie, { nameZh: "ZH Deck", nameEn: "Deck" });
      const res = await app.request(`/projects/${shipShortId}/equipment-categories/${category.id}`, jsonReq("PATCH", adminCookie, {}));
      expect(res.status).toBe(422);
    });
  });
});

// Permission PARITY with the worklist section: per-project equipment categories
// reuse the SAME gates (project membership for GET, `project.manage` for
// writes) — they invent no separate membership or capability. Each test drives
// BOTH `/projects/:projectId/worklists` and
// `/projects/:projectId/equipment-categories` with the SAME actor and asserts
// the status codes match verb-for-verb, so the equivalence is literal (both
// routers are mounted by shipRoutes()).
describe("permission parity with project worklists", () => {
  async function status(app: Hono<AppEnv>, method: string, cookie: string, path: string, body?: unknown): Promise<number> {
    return (await app.request(path, jsonReq(method, cookie, body))).status;
  }

  test("a worklist reader/writer has identical access to equipment-categories", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // Admin (PM) can write both — POST parity.
    const wlPost = await status(app, "POST", adminCookie, `/projects/${shipShortId}/worklists`, { name: "WL" });
    const catPost = await status(app, "POST", adminCookie, `/projects/${shipShortId}/equipment-categories`, { nameZh: "ZH Main Engine", nameEn: "Main Engine" });
    expect(catPost).toBe(wlPost);
    expect(catPost).toBe(201);

    // A plain project member (Reader) — same read=200 / write=403 on both.
    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memberCookie = await cookieForUser(member);

    const wlRead = await status(app, "GET", memberCookie, `/projects/${shipShortId}/worklists`);
    const catRead = await status(app, "GET", memberCookie, `/projects/${shipShortId}/equipment-categories`);
    expect(catRead).toBe(wlRead);
    expect(catRead).toBe(200);

    const wlWrite = await status(app, "POST", memberCookie, `/projects/${shipShortId}/worklists`, { name: "Nope" });
    const catWrite = await status(app, "POST", memberCookie, `/projects/${shipShortId}/equipment-categories`, { nameZh: "x", nameEn: "x" });
    expect(catWrite).toBe(wlWrite);
    expect(catWrite).toBe(403);
  });

  test("a user who cannot access project worklists is rejected identically on equipment-categories", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);
    const outsider = await sessionFor("user"); // not a project member

    const wlRead = await status(app, "GET", outsider.cookie, `/projects/${shipShortId}/worklists`);
    const catRead = await status(app, "GET", outsider.cookie, `/projects/${shipShortId}/equipment-categories`);
    expect(catRead).toBe(wlRead);
    expect(catRead).toBe(404); // fail-closed, identical to worklists

    const wlWrite = await status(app, "POST", outsider.cookie, `/projects/${shipShortId}/worklists`, { name: "Nope" });
    const catWrite = await status(app, "POST", outsider.cookie, `/projects/${shipShortId}/equipment-categories`, { nameZh: "x", nameEn: "x" });
    expect(catWrite).toBe(wlWrite);
    expect(catWrite).toBe(404);
  });

  test("a member of project A is rejected identically on project B worklists and equipment-categories", async () => {
    const app = buildApp(db);
    const shipA = await createShipAsAdmin(app, "A");
    const shipBShortId = (await createProject(db, { name: "B", creatorId: shipA.adminId, preset: "ship" })).shortId;

    // A user who is a member of project A ONLY.
    const userA = await seedUser("user");
    await addMember(db, shipA.baseProjectInternalId, { roleId: await memberRoleId(shipA.baseProjectInternalId), userId: userA });
    const cookieA = await cookieForUser(userA);

    const wlRead = await status(app, "GET", cookieA, `/projects/${shipBShortId}/worklists`);
    const catRead = await status(app, "GET", cookieA, `/projects/${shipBShortId}/equipment-categories`);
    expect(catRead).toBe(wlRead);
    expect(catRead).toBe(404);

    const wlWrite = await status(app, "POST", cookieA, `/projects/${shipBShortId}/worklists`, { name: "Nope" });
    const catWrite = await status(app, "POST", cookieA, `/projects/${shipBShortId}/equipment-categories`, { nameZh: "x", nameEn: "x" });
    expect(catWrite).toBe(wlWrite);
    expect(catWrite).toBe(404);
  });
});
