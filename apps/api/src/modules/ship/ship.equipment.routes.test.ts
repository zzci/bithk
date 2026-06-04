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

async function createShipAsAdmin(app: Hono<AppEnv>, name = "Aurora"): Promise<{ adminId: string; adminCookie: string; shipShortId: string; baseProjectInternalId: string }> {
  const admin = await sessionFor("admin");
  const res = await app.request("/ships", jsonReq("POST", admin.cookie, { name }));
  expect(res.status).toBe(201);
  const body = await res.json() as { data: { id: string } };
  const ship = await getShipByShortId(db, body.data.id);
  return { adminId: admin.userId, adminCookie: admin.cookie, shipShortId: body.data.id, baseProjectInternalId: ship!.baseProjectId! };
}

interface EquipmentBody {
  data: {
    id: string;
    name: string;
    status: string;
    categoryId: string | null;
    categoryNameZh: string | null;
    categoryNameEn: string | null;
    manufacturerId: string | null;
    manufacturerName: string | null;
    note: string | null;
  };
}

interface CategoryBody {
  data: { id: string; nameZh: string; nameEn: string };
}

interface ManufacturerBody {
  data: { id: string; name: string };
}

async function createCategory(app: Hono<AppEnv>, shipShortId: string, cookie: string, nameZh: string, nameEn: string): Promise<string> {
  const res = await app.request(`/ships/${shipShortId}/equipment-categories`, jsonReq("POST", cookie, { nameZh, nameEn }));
  expect(res.status).toBe(201);
  return ((await res.json()) as CategoryBody).data.id;
}

async function createManufacturer(app: Hono<AppEnv>, cookie: string, name: string): Promise<string> {
  const res = await app.request("/global-equipment-manufacturers", jsonReq("POST", cookie, { name }));
  expect(res.status).toBe(201);
  return ((await res.json()) as ManufacturerBody).data.id;
}

async function createEquipment(app: Hono<AppEnv>, shipShortId: string, cookie: string, body: unknown): Promise<string> {
  const res = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", cookie, body));
  expect(res.status).toBe(201);
  return ((await res.json()) as EquipmentBody).data.id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-equipment-${Date.now()}-${nanoid()}`);
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

describe("equipment CRUD", () => {
  test("PM creates, lists, gets, updates and deletes equipment", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const categoryId = await createCategory(app, shipShortId, adminCookie, "推进系统", "Propulsion");
    const manufacturerId = await createManufacturer(app, adminCookie, "MTU");

    // Create.
    const createRes = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", adminCookie, {
      name: "Main Engine",
      categoryId,
      manufacturerId,
      status: "active",
    }));
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as EquipmentBody;
    expect(created.data.name).toBe("Main Engine");
    expect(created.data.categoryId).toBe(categoryId);
    expect(created.data.categoryNameZh).toBe("推进系统");
    expect(created.data.categoryNameEn).toBe("Propulsion");
    expect(created.data.manufacturerId).toBe(manufacturerId);
    expect(created.data.manufacturerName).toBe("MTU");
    expect(created.data.status).toBe("active");
    const equipmentId = created.data.id;

    // List.
    const listRes = await app.request(`/ships/${shipShortId}/equipment`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { data: { id: string }[] };
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]!.id).toBe(equipmentId);

    // Get.
    const getRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: adminCookie } });
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as EquipmentBody).data.name).toBe("Main Engine");

    // Update.
    const patchRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("PATCH", adminCookie, {
      status: "retired",
      note: "decommissioned",
    }));
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as EquipmentBody;
    expect(patched.data.status).toBe("retired");
    expect(patched.data.note).toBe("decommissioned");
    expect(patched.data.name).toBe("Main Engine");

    // Delete.
    const delRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("DELETE", adminCookie));
    expect(delRes.status).toBe(200);
    const afterRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: adminCookie } });
    expect(afterRes.status).toBe(404);
  });

  test("equipment without a category resolves null names", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const equipmentId = await createEquipment(app, shipShortId, adminCookie, { name: "Radar" });
    const getRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: adminCookie } });
    const view = (await getRes.json()) as EquipmentBody;
    expect(view.data.categoryId).toBeNull();
    expect(view.data.categoryNameZh).toBeNull();
    expect(view.data.categoryNameEn).toBeNull();
  });

  test("deleting a referenced category nulls the equipment's category (set null)", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const categoryId = await createCategory(app, shipShortId, adminCookie, "导航设备", "Navigation");
    const equipmentId = await createEquipment(app, shipShortId, adminCookie, { name: "Chartplotter", categoryId });

    const delRes = await app.request(`/ships/${shipShortId}/equipment-categories/${categoryId}`, jsonReq("DELETE", adminCookie));
    expect(delRes.status).toBe(200);

    const getRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: adminCookie } });
    const view = (await getRes.json()) as EquipmentBody;
    expect(view.data.categoryId).toBeNull();
    expect(view.data.categoryNameZh).toBeNull();
    expect(view.data.categoryNameEn).toBeNull();
  });

  test("rejects an empty name with 422", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", adminCookie, { name: "" }));
    expect(res.status).toBe(422);
  });

  test("PATCH with no fields → 422", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const equipmentId = await createEquipment(app, shipShortId, adminCookie, { name: "Radar" });
    const res = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("PATCH", adminCookie, {}));
    expect(res.status).toBe(422);
  });

  test("equipment of another ship is not reachable (404)", async () => {
    const app = buildApp(db);
    const shipA = await createShipAsAdmin(app, "A");
    const equipmentId = await createEquipment(app, shipA.shipShortId, shipA.adminCookie, { name: "Pump" });

    // Reuse the same admin (PM of both base projects) to isolate scoping from authz.
    const resB = await app.request("/ships", jsonReq("POST", shipA.adminCookie, { name: "B" }));
    const shipBShortId = ((await resB.json()) as { data: { id: string } }).data.id;

    const crossGet = await app.request(`/ships/${shipBShortId}/equipment/${equipmentId}`, { headers: { Cookie: shipA.adminCookie } });
    expect(crossGet.status).toBe(404);
    const crossPatch = await app.request(`/ships/${shipBShortId}/equipment/${equipmentId}`, jsonReq("PATCH", shipA.adminCookie, { name: "X" }));
    expect(crossPatch.status).toBe(404);
    const crossDelete = await app.request(`/ships/${shipBShortId}/equipment/${equipmentId}`, jsonReq("DELETE", shipA.adminCookie));
    expect(crossDelete.status).toBe(404);
  });
});

describe("equipment authz", () => {
  test("a base-project member can read but cannot write", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);
    const equipmentId = await createEquipment(app, shipShortId, adminCookie, { name: "Generator" });

    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memberCookie = await cookieForUser(member);

    // Read: list + get succeed.
    const listRes = await app.request(`/ships/${shipShortId}/equipment`, { headers: { Cookie: memberCookie } });
    expect(listRes.status).toBe(200);
    const getRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: memberCookie } });
    expect(getRes.status).toBe(200);

    // Write: create / patch / delete all 403 (no project.manage).
    const createRes = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", memberCookie, { name: "X" }));
    expect(createRes.status).toBe(403);
    const patchRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("PATCH", memberCookie, { name: "X" }));
    expect(patchRes.status).toBe(403);
    const delRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("DELETE", memberCookie));
    expect(delRes.status).toBe(403);
  });

  test("a non-member gets fail-closed 404 on read and write", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const equipmentId = await createEquipment(app, shipShortId, adminCookie, { name: "Anchor" });

    const outsider = await sessionFor("user");

    const listRes = await app.request(`/ships/${shipShortId}/equipment`, { headers: { Cookie: outsider.cookie } });
    expect(listRes.status).toBe(404);
    const getRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: outsider.cookie } });
    expect(getRes.status).toBe(404);
    const createRes = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", outsider.cookie, { name: "X" }));
    expect(createRes.status).toBe(404);
    const patchRes = await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, jsonReq("PATCH", outsider.cookie, { name: "X" }));
    expect(patchRes.status).toBe(404);
  });

  test("GET equipment list → 401 without a session", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/ships/${shipShortId}/equipment`);
    expect(res.status).toBe(401);
  });
});
