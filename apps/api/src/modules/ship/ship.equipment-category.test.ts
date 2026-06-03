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

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

interface CategoryView { id: string; nameZh: string; nameEn: string; code: string | null; description: string | null; createdAt: string; updatedAt: string }

async function dataOf<T>(r: Response): Promise<T> {
  return (await r.json() as { data: T }).data;
}

async function createCategory(app: Hono<AppEnv>, cookie: string, body: Record<string, unknown>): Promise<CategoryView> {
  const res = await app.request("/equipment-categories", jsonReq("POST", cookie, body));
  expect(res.status).toBe(201);
  return dataOf<CategoryView>(res);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-equip-cat-${Date.now()}-${nanoid()}`);
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

describe("equipment category vocabulary (admin only)", () => {
  test("non-admin is rejected with 403 on every verb", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("user");
    expect((await app.request("/equipment-categories", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await app.request("/equipment-categories/x", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await app.request("/equipment-categories", jsonReq("POST", cookie, { nameZh: "主机", nameEn: "Main Engine" }))).status).toBe(403);
    expect((await app.request("/equipment-categories/x", jsonReq("PATCH", cookie, { nameEn: "X" }))).status).toBe(403);
    expect((await app.request("/equipment-categories/x", jsonReq("DELETE", cookie))).status).toBe(403);
  });

  test("unauthenticated is rejected with 401", async () => {
    const res = await buildApp(db).request("/equipment-categories");
    expect(res.status).toBe(401);
  });

  test("admin full CRUD round-trip", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    // Create.
    const created = await createCategory(app, admin.cookie, { nameZh: "导航设备", nameEn: "Navigation", code: "NAV", description: "Bridge nav gear" });
    expect(created.nameZh).toBe("导航设备");
    expect(created.nameEn).toBe("Navigation");
    expect(created.code).toBe("NAV");
    expect(created.description).toBe("Bridge nav gear");

    // List (ordered by createdAt desc).
    const list = await dataOf<CategoryView[]>(await app.request("/equipment-categories", { headers: { Cookie: admin.cookie } }));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);

    // Get :id.
    const getRes = await app.request(`/equipment-categories/${created.id}`, { headers: { Cookie: admin.cookie } });
    expect(getRes.status).toBe(200);
    expect((await dataOf<CategoryView>(getRes)).nameEn).toBe("Navigation");

    // Patch (partial — only nameEn).
    const patchRes = await app.request(`/equipment-categories/${created.id}`, jsonReq("PATCH", admin.cookie, { nameEn: "Nav Systems" }));
    expect(patchRes.status).toBe(200);
    const patched = await dataOf<CategoryView>(patchRes);
    expect(patched.nameEn).toBe("Nav Systems");
    expect(patched.nameZh).toBe("导航设备");

    // Delete → then 404 on get.
    const delRes = await app.request(`/equipment-categories/${created.id}`, jsonReq("DELETE", admin.cookie));
    expect(delRes.status).toBe(200);
    expect((await app.request(`/equipment-categories/${created.id}`, { headers: { Cookie: admin.cookie } })).status).toBe(404);
  });

  test("patch / delete / get of a missing category → 404", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    expect((await app.request("/equipment-categories/nope", { headers: { Cookie: admin.cookie } })).status).toBe(404);
    expect((await app.request("/equipment-categories/nope", jsonReq("PATCH", admin.cookie, { nameEn: "X" }))).status).toBe(404);
    expect((await app.request("/equipment-categories/nope", jsonReq("DELETE", admin.cookie))).status).toBe(404);
  });

  test("create writes an audit event with nameZh as resource name", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const created = await createCategory(app, admin.cookie, { nameZh: "消防设备", nameEn: "Fire-fighting" });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, created.id)).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("equipment_category.created");
    expect(events[0]!.resourceType).toBe("equipment_category");
    expect(events[0]!.resourceName).toBe("消防设备");
  });

  describe("validation", () => {
    test("blank / whitespace name rejected with 422", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      expect((await app.request("/equipment-categories", jsonReq("POST", admin.cookie, { nameZh: "   ", nameEn: "Steering" }))).status).toBe(422);
      expect((await app.request("/equipment-categories", jsonReq("POST", admin.cookie, { nameZh: "舵机", nameEn: "" }))).status).toBe(422);
    });

    test("names longer than 100 chars rejected with 422", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      const res = await app.request("/equipment-categories", jsonReq("POST", admin.cookie, { nameZh: "舵", nameEn: "S".repeat(101) }));
      expect(res.status).toBe(422);
    });

    test("trims names before storing", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      const created = await createCategory(app, admin.cookie, { nameZh: "  锚泊设备  ", nameEn: "  Anchoring  " });
      expect(created.nameZh).toBe("锚泊设备");
      expect(created.nameEn).toBe("Anchoring");
    });

    test("duplicate name_zh or name_en rejected with a clean 4xx", async () => {
      const app = buildApp(db);
      const admin = await sessionFor("admin");
      await createCategory(app, admin.cookie, { nameZh: "主机", nameEn: "Main Engine" });

      const dupZh = await app.request("/equipment-categories", jsonReq("POST", admin.cookie, { nameZh: "主机", nameEn: "Different" }));
      expect(dupZh.status).toBe(422);
      const dupEn = await app.request("/equipment-categories", jsonReq("POST", admin.cookie, { nameZh: "不同", nameEn: "Main Engine" }));
      expect(dupEn.status).toBe(422);
    });
  });

  test("deleting a referenced category nulls the equipment's category (set null)", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const category = await createCategory(app, admin.cookie, { nameZh: "推进系统", nameEn: "Propulsion" });

    // Create a ship + a piece of equipment referencing the category.
    const shipRes = await app.request("/ships", jsonReq("POST", admin.cookie, { name: "Aurora" }));
    const shipShortId = (await dataOf<{ id: string }>(shipRes)).id;
    const ship = await getShipByShortId(db, shipShortId);
    expect(ship).toBeTruthy();

    const eqRes = await app.request(`/ships/${shipShortId}/equipment`, jsonReq("POST", admin.cookie, { name: "Main Engine", categoryId: category.id }));
    expect(eqRes.status).toBe(201);
    const equipmentId = (await dataOf<{ id: string; categoryId: string | null }>(eqRes)).id;

    // Delete the category → equipment.category_id becomes null (ON DELETE SET NULL).
    const delRes = await app.request(`/equipment-categories/${category.id}`, jsonReq("DELETE", admin.cookie));
    expect(delRes.status).toBe(200);

    const after = await dataOf<{ categoryId: string | null; categoryNameZh: string | null; categoryNameEn: string | null }>(
      await app.request(`/ships/${shipShortId}/equipment/${equipmentId}`, { headers: { Cookie: admin.cookie } }),
    );
    expect(after.categoryId).toBeNull();
    expect(after.categoryNameZh).toBeNull();
    expect(after.categoryNameEn).toBeNull();
  });
});
