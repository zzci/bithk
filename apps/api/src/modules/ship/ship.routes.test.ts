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
import { globalEquipmentCategories, shipEquipmentCategories, shipProfiles } from "./schema";
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

interface ShipProject {
  ownerId: string;
  ownerCookie: string;
  shortId: string;
  internalId: string;
}

/** Create a ship-preset project (the fold's replacement for `POST /ships`). */
async function createShipProject(name = "Aurora", sectionData?: Record<string, unknown>): Promise<ShipProject> {
  const ownerId = await seedUser("user");
  const project = await createProject(db, {
    name,
    creatorId: ownerId,
    preset: "ship",
    ...(sectionData ? { sectionData } : {}),
  });
  return { ownerId, ownerCookie: await cookieForUser(ownerId), shortId: project.shortId, internalId: project.id };
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

describe("the /ships module is gone", () => {
  test("every former /ships route 404s", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    for (const path of ["/ships", "/ships/abc12345", "/ships/abc12345/equipment", "/ships/abc12345/worklists"]) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    }
  });
});

describe("provisioning a ship-preset project", () => {
  test("inserts the profile row and copies the global equipment categories in one transaction", async () => {
    const now = new Date().toISOString();
    await db.insert(globalEquipmentCategories).values([
      { id: nanoid(), nameZh: "ZH Main Engine", nameEn: "Main Engine", code: "ME", description: null, createdAt: now, updatedAt: now },
      { id: nanoid(), nameZh: "ZH Generator", nameEn: "Generator", code: null, description: null, createdAt: now, updatedAt: now },
    ]).run();

    const ship = await createShipProject("Aurora", { "ship-profile": { hullNumber: "HULL-9", shipStatus: "active", imoNumber: "IMO-1" } });

    const profile = await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, ship.internalId)).get();
    expect(profile?.hullNumber).toBe("HULL-9");
    expect(profile?.shipStatus).toBe("active");
    expect(profile?.imoNumber).toBe("IMO-1");

    const categories = await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, ship.internalId)).all();
    expect(categories.map(c => c.nameEn).sort()).toEqual(["Generator", "Main Engine"]);
  });

  test("a general-preset project gets neither a profile nor copied categories", async () => {
    const now = new Date().toISOString();
    await db.insert(globalEquipmentCategories).values({
      id: nanoid(),
      nameZh: "ZH Main Engine",
      nameEn: "Main Engine",
      code: null,
      description: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const owner = await seedUser("user");
    const project = await createProject(db, { name: "Plain", creatorId: owner });

    expect(await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, project.id)).get()).toBeUndefined();
    expect(await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, project.id)).all()).toHaveLength(0);
  });

  test("a profile row is created even without a ship-profile payload", async () => {
    const ship = await createShipProject("Bare");
    const profile = await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, ship.internalId)).get();
    expect(profile).toBeTruthy();
    expect(profile!.shipStatus).toBe("laid_up");
  });

  test("a duplicate hull number rolls the whole creation back", async () => {
    await createShipProject("First", { "ship-profile": { hullNumber: "HULL-DUP" } });
    const owner = await seedUser("user");
    await expect(createProject(db, {
      name: "Second",
      creatorId: owner,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "HULL-DUP" } },
    })).rejects.toThrow();
  });
});

describe("requireSection gates every ship surface", () => {
  test("a general project 404s on ship-profile, equipment and worklists", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "Plain", creatorId: owner });
    const cookie = await cookieForUser(owner);

    for (const path of ["ship-profile", "equipment", "equipment-categories", "worklists", "referenceable-worklists"]) {
      const res = await app.request(`/projects/${project.shortId}/${path}`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    }
  });

  test("an unknown project 404s too (existence is not leaked)", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    const res = await app.request("/projects/nope1234/ship-profile", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("unmounting the section removes the surface", async () => {
    const app = buildApp(db);
    const ship = await createShipProject("Aurora");
    expect((await app.request(`/projects/${ship.shortId}/worklists`, { headers: { Cookie: ship.ownerCookie } })).status).toBe(200);

    const { unmountSection } = await import("@/modules/project/section.service");
    await unmountSection(db, ship.internalId, "worklist");

    expect((await app.request(`/projects/${ship.shortId}/worklists`, { headers: { Cookie: ship.ownerCookie } })).status).toBe(404);
  });
});

describe("GET /projects/:projectId/ship-profile", () => {
  test("401 without a session", async () => {
    const ship = await createShipProject();
    const res = await buildApp(db).request(`/projects/${ship.shortId}/ship-profile`);
    expect(res.status).toBe(401);
  });

  test("the owner reads it; a plain member reads it; an outsider gets 404", async () => {
    const app = buildApp(db);
    const ship = await createShipProject("Aurora", { "ship-profile": { hullNumber: "HULL-3", mmsi: "123456789" } });

    const ownRes = await app.request(`/projects/${ship.shortId}/ship-profile`, { headers: { Cookie: ship.ownerCookie } });
    expect(ownRes.status).toBe(200);
    const body = await ownRes.json() as { data: { hullNumber: string; mmsi: string | null } };
    expect(body.data.hullNumber).toBe("HULL-3");
    expect(body.data.mmsi).toBe("123456789");

    const member = await seedUser("user");
    await addMember(db, ship.internalId, { roleId: await memberRoleId(ship.internalId), userId: member });
    expect((await app.request(`/projects/${ship.shortId}/ship-profile`, { headers: { Cookie: await cookieForUser(member) } })).status).toBe(200);

    const outsider = await sessionFor("user");
    expect((await app.request(`/projects/${ship.shortId}/ship-profile`, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
  });

  test("an app admin reads it without being a member", async () => {
    const app = buildApp(db);
    const ship = await createShipProject();
    const admin = await sessionFor("admin");
    expect((await app.request(`/projects/${ship.shortId}/ship-profile`, { headers: { Cookie: admin.cookie } })).status).toBe(200);
  });
});

describe("PUT /projects/:projectId/ship-profile", () => {
  test("the owner updates; a plain member gets 403; an outsider gets 404", async () => {
    const app = buildApp(db);
    const ship = await createShipProject("Aurora", { "ship-profile": { hullNumber: "HULL-4" } });

    const ok = await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", ship.ownerCookie, { hullNumber: "HULL-5", shipStatus: "underway" }));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { data: { hullNumber: string; shipStatus: string } };
    expect(body.data.hullNumber).toBe("HULL-5");
    expect(body.data.shipStatus).toBe("underway");

    const member = await seedUser("user");
    await addMember(db, ship.internalId, { roleId: await memberRoleId(ship.internalId), userId: member });
    expect((await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", await cookieForUser(member), { hullNumber: "X" }))).status).toBe(403);

    const outsider = await sessionFor("user");
    expect((await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", outsider.cookie, { hullNumber: "X" }))).status).toBe(404);
  });

  test("an empty patch is rejected with 422", async () => {
    const app = buildApp(db);
    const ship = await createShipProject();
    const res = await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", ship.ownerCookie, {}));
    expect(res.status).toBe(422);
  });

  test("a hull number already used by another project is rejected with 422", async () => {
    const app = buildApp(db);
    await createShipProject("First", { "ship-profile": { hullNumber: "HULL-TAKEN" } });
    const second = await createShipProject("Second", { "ship-profile": { hullNumber: "HULL-FREE" } });

    const res = await app.request(`/projects/${second.shortId}/ship-profile`, jsonReq("PUT", second.ownerCookie, { hullNumber: "HULL-TAKEN" }));
    expect(res.status).toBe(422);
  });

  test("the hull number keeps its case, unlike the lowercased project code", async () => {
    const app = buildApp(db);
    const ship = await createShipProject();
    const res = await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", ship.ownerCookie, { hullNumber: "Hull-MixedCase" }));
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { hullNumber: string } }).data.hullNumber).toBe("Hull-MixedCase");
  });
});

describe("deleting a ship-preset project", () => {
  test("softDeleteProject removes every ship surface (no admin-only ship delete)", async () => {
    const app = buildApp(db);
    const ship = await createShipProject();
    const { softDeleteProject } = await import("@/modules/project/project.service");
    await softDeleteProject(db, ship.shortId);

    const res = await app.request(`/projects/${ship.shortId}/ship-profile`, { headers: { Cookie: ship.ownerCookie } });
    expect(res.status).toBe(404);
  });
});
