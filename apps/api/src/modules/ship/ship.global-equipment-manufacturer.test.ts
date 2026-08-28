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
import { auditEvents } from "@/modules/audit/schema";
import { createProject } from "@/modules/project/project.service";
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

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

interface ManufacturerView { id: string; name: string; code: string | null; description: string | null; createdAt: string; updatedAt: string }

async function dataOf<T>(r: Response): Promise<T> {
  return (await r.json() as { data: T }).data;
}

async function createManufacturer(app: Hono<AppEnv>, cookie: string, body: Record<string, unknown>): Promise<ManufacturerView> {
  const res = await app.request("/global-equipment-manufacturers", jsonReq("POST", cookie, body));
  expect(res.status).toBe(201);
  return dataOf<ManufacturerView>(res);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-equip-mfr-${Date.now()}-${nanoid()}`);
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

describe("global equipment manufacturer vocabulary (admin only)", () => {
  test("non-admin is rejected with 403 on every verb", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("user");
    expect((await app.request("/global-equipment-manufacturers", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await app.request("/global-equipment-manufacturers/x", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await app.request("/global-equipment-manufacturers", jsonReq("POST", cookie, { name: "MTU" }))).status).toBe(403);
    expect((await app.request("/global-equipment-manufacturers/x", jsonReq("PATCH", cookie, { name: "X" }))).status).toBe(403);
    expect((await app.request("/global-equipment-manufacturers/x", jsonReq("DELETE", cookie))).status).toBe(403);
  });

  test("unauthenticated is rejected with 401", async () => {
    const res = await buildApp(db).request("/global-equipment-manufacturers");
    expect(res.status).toBe(401);
  });

  test("admin full CRUD round-trip", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    // Create.
    const created = await createManufacturer(app, admin.cookie, { name: "MTU", code: "MTU", description: "German engines" });
    expect(created.name).toBe("MTU");
    expect(created.code).toBe("MTU");
    expect(created.description).toBe("German engines");

    // List (ordered by createdAt desc).
    const list = await dataOf<ManufacturerView[]>(await app.request("/global-equipment-manufacturers", { headers: { Cookie: admin.cookie } }));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);

    // Get :id.
    const getRes = await app.request(`/global-equipment-manufacturers/${created.id}`, { headers: { Cookie: admin.cookie } });
    expect(getRes.status).toBe(200);
    expect((await dataOf<ManufacturerView>(getRes)).name).toBe("MTU");

    // Patch (partial — only name).
    const patchRes = await app.request(`/global-equipment-manufacturers/${created.id}`, jsonReq("PATCH", admin.cookie, { name: "MTU Friedrichshafen" }));
    expect(patchRes.status).toBe(200);
    const patched = await dataOf<ManufacturerView>(patchRes);
    expect(patched.name).toBe("MTU Friedrichshafen");
    expect(patched.code).toBe("MTU");

    // Delete → then 404 on get.
    const delRes = await app.request(`/global-equipment-manufacturers/${created.id}`, jsonReq("DELETE", admin.cookie));
    expect(delRes.status).toBe(200);
    expect((await app.request(`/global-equipment-manufacturers/${created.id}`, { headers: { Cookie: admin.cookie } })).status).toBe(404);
  });

  test("patch / delete / get of a missing manufacturer → 404", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    expect((await app.request("/global-equipment-manufacturers/nope", { headers: { Cookie: admin.cookie } })).status).toBe(404);
    expect((await app.request("/global-equipment-manufacturers/nope", jsonReq("PATCH", admin.cookie, { name: "X" }))).status).toBe(404);
    expect((await app.request("/global-equipment-manufacturers/nope", jsonReq("DELETE", admin.cookie))).status).toBe(404);
  });

  test("create writes an audit event with name as resource name", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const created = await createManufacturer(app, admin.cookie, { name: "Caterpillar" });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, created.id)).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("equipment_manufacturer.created");
    expect(events[0]!.resourceType).toBe("equipment_manufacturer");
    expect(events[0]!.resourceName).toBe("Caterpillar");
  });

  describe("validation", () => {
    test("blank / whitespace name rejected with 422", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      expect((await app.request("/global-equipment-manufacturers", jsonReq("POST", admin.cookie, { name: "   " }))).status).toBe(422);
      expect((await app.request("/global-equipment-manufacturers", jsonReq("POST", admin.cookie, {}))).status).toBe(422);
    });

    test("names longer than 100 chars rejected with 422", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      const res = await app.request("/global-equipment-manufacturers", jsonReq("POST", admin.cookie, { name: "M".repeat(101) }));
      expect(res.status).toBe(422);
    });

    test("trims name before storing", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      const created = await createManufacturer(app, admin.cookie, { name: "  Volvo Penta  " });
      expect(created.name).toBe("Volvo Penta");
    });

    test("duplicate name rejected with a clean 422", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      await createManufacturer(app, admin.cookie, { name: "MTU" });
      const dup = await app.request("/global-equipment-manufacturers", jsonReq("POST", admin.cookie, { name: "MTU" }));
      expect(dup.status).toBe(422);
    });
  });

  test("deleting a manufacturer nulls referencing equipment (FK set null)", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    // A manufacturer + a ship-preset project to attach equipment to.
    const manufacturer = await createManufacturer(app, admin.cookie, { name: "MTU" });
    const shipShortId = (await createProject(db, { name: "Aurora", creatorId: admin.userId, preset: "ship" })).shortId;

    // Attach the manufacturer to a piece of equipment.
    const createEquipRes = await app.request(`/projects/${shipShortId}/equipment`, jsonReq("POST", admin.cookie, { name: "Main Engine", manufacturerId: manufacturer.id }));
    expect(createEquipRes.status).toBe(201);
    const equipment = (await createEquipRes.json()) as { data: { id: string; manufacturerId: string | null; manufacturerName: string | null } };
    expect(equipment.data.manufacturerId).toBe(manufacturer.id);
    expect(equipment.data.manufacturerName).toBe("MTU");

    // Delete the manufacturer → the equipment's reference is nulled.
    const delRes = await app.request(`/global-equipment-manufacturers/${manufacturer.id}`, jsonReq("DELETE", admin.cookie));
    expect(delRes.status).toBe(200);

    const getRes = await app.request(`/projects/${shipShortId}/equipment/${equipment.data.id}`, { headers: { Cookie: admin.cookie } });
    const view = (await getRes.json()) as { data: { manufacturerId: string | null; manufacturerName: string | null } };
    expect(view.data.manufacturerId).toBeNull();
    expect(view.data.manufacturerName).toBeNull();
  });
});
