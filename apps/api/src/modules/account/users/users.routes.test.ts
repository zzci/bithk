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
import { backfillGlobalRoles, createGlobalRole, resolveDefaultRole } from "@/modules/account/roles/roles.service";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { MODULE_KEYS } from "@/shared/modules";
import { userRoutes } from "./users.routes";
import { assertNotLastActiveAdmin } from "./users.service";
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
  app.route("/", userRoutes());
  app.onError(errorHandler);
  return app;
}

let db: AppDatabase;
let dbPath: string;

async function sessionForUser(): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  const sessionId = await createSession(db, id, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function putPref(cookie: string, value: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({ value }),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-users-routes-${Date.now()}-${nanoid()}`);
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

describe("PUT /account/me/preferences/:key bounds (FIX-AUDIT-016)", () => {
  test("a normal preference is stored (200)", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const res = await app.request("/account/me/preferences/theme", putPref(cookie, "dark"));
    expect(res.status).toBe(200);
  });

  test("an over-long key is rejected with 422", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const res = await app.request(`/account/me/preferences/${"k".repeat(201)}`, putPref(cookie, "x"));
    expect(res.status).toBe(422);
  });

  test("an over-large serialized value is rejected with 413", async () => {
    const app = buildApp(db);
    const cookie = await sessionForUser();
    const big = "a".repeat(64 * 1024 + 1);
    const res = await app.request("/account/me/preferences/blob", putPref(cookie, big));
    expect(res.status).toBe(413);
  });
});

async function sessionForRole(role: "admin" | "user"): Promise<{ id: string; cookie: string }> {
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
  const sessionId = await createSession(db, id, "access-token", undefined, 3600);
  return { id, cookie: `session_id=${sessionId}` };
}

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

describe("virtual user admin endpoints", () => {
  test("admin creates a virtual user (201); a plain user is forbidden (403)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const plain = await sessionForRole("user");

    const denied = await app.request("/account/users", jsonReq("POST", plain.cookie, { username: "vx", name: "Vx" }));
    expect(denied.status).toBe(403);

    const res = await app.request("/account/users", jsonReq("POST", admin.cookie, { username: "vstaff", name: "Virtual Staff" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; isVirtual: boolean; username: string } };
    expect(body.data.isVirtual).toBe(true);
    expect(body.data.username).toBe("vstaff");
  });

  test("rejects an invalid username (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const res = await app.request("/account/users", jsonReq("POST", admin.cookie, { username: "Bad Name!", name: "X" }));
    expect(res.status).toBe(422);
  });

  test("assignable-users includes virtual users; visible-users excludes them", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    await app.request("/account/users", jsonReq("POST", admin.cookie, { username: "vpick", name: "V Pick" }));

    const visible = await (await app.request("/account/visible-users", { headers: { Cookie: admin.cookie } })).json() as { data: { username: string }[] };
    expect(visible.data.some(u => u.username === "vpick")).toBe(false);

    const assignable = await (await app.request("/account/assignable-users", { headers: { Cookie: admin.cookie } })).json() as { data: { username: string; isVirtual: boolean }[] };
    expect(assignable.data.some(u => u.username === "vpick" && u.isVirtual)).toBe(true);
  });

  test("DELETE refuses a real user (409) but removes a virtual one (200)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const real = await sessionForRole("user");

    const refuse = await app.request(`/account/users/${real.id}`, jsonReq("DELETE", admin.cookie));
    expect(refuse.status).toBe(409);

    const created = await app.request("/account/users", jsonReq("POST", admin.cookie, { username: "vgone", name: "Gone" }));
    const cbody = await created.json() as { data: { id: string } };
    const del = await app.request(`/account/users/${cbody.data.id}`, jsonReq("DELETE", admin.cookie));
    expect(del.status).toBe(200);
  });

  test("PATCH renames a virtual user; rejects renaming a real user (400)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const real = await sessionForRole("user");

    const created = await app.request("/account/users", jsonReq("POST", admin.cookie, { username: "vren", name: "Old" }));
    const cbody = await created.json() as { data: { id: string } };
    const patched = await app.request(`/account/users/${cbody.data.id}`, jsonReq("PATCH", admin.cookie, { name: "New", username: "vren2" }));
    expect(patched.status).toBe(200);
    const pbody = await patched.json() as { data: { username: string; name: string } };
    expect(pbody.data.username).toBe("vren2");
    expect(pbody.data.name).toBe("New");

    const realRename = await app.request(`/account/users/${real.id}`, jsonReq("PATCH", admin.cookie, { username: "hacker" }));
    expect(realRename.status).toBe(400);
  });
});

describe("PATCH /account/users/:id globalRoleId (PLAN-076 lane D)", () => {
  test("admin assigns an existing global role; detail returns it", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const target = await sessionForRole("user");
    const role = await createGlobalRole(db, { name: "Docs only", modules: ["documents"] });

    const res = await app.request(`/account/users/${target.id}`, jsonReq("PATCH", admin.cookie, { globalRoleId: role.id }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { globalRoleId: string | null } };
    expect(body.data.globalRoleId).toBe(role.id);

    const detail = await (await app.request(`/account/users/${target.id}`, { headers: { Cookie: admin.cookie } })).json() as { data: { globalRoleId: string | null } };
    expect(detail.data.globalRoleId).toBe(role.id);
  });

  test("explicit null resets the assignment to the default-role fallback", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const target = await sessionForRole("user");
    const role = await createGlobalRole(db, { name: "Drive only", modules: ["drive"] });
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, target.id)).run();

    const res = await app.request(`/account/users/${target.id}`, jsonReq("PATCH", admin.cookie, { globalRoleId: null }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { globalRoleId: string | null } };
    expect(body.data.globalRoleId).toBeNull();
  });

  test("an unknown role id is rejected with 422; a plain user is forbidden (403)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const plain = await sessionForRole("user");
    const target = await sessionForRole("user");

    const invalid = await app.request(`/account/users/${target.id}`, jsonReq("PATCH", admin.cookie, { globalRoleId: "missing" }));
    expect(invalid.status).toBe(422);

    const denied = await app.request(`/account/users/${target.id}`, jsonReq("PATCH", plain.cookie, { globalRoleId: null }));
    expect(denied.status).toBe(403);
  });
});

describe("GET /account/me modules (PLAN-076)", () => {
  async function meModules(cookie: string): Promise<string[]> {
    const res = await buildApp(db).request("/account/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { modules: string[] } };
    return body.data.modules;
  }

  test("an admin gets every registered module key", async () => {
    const admin = await sessionForRole("admin");
    expect(await meModules(admin.cookie)).toEqual([...MODULE_KEYS]);
  });

  test("a NULL-role user gets the Guest floor — no modules", async () => {
    await backfillGlobalRoles(db);
    const plain = await sessionForRole("user");
    expect(await meModules(plain.cookie)).toEqual([]);
  });

  test("an assigned role's modules are returned", async () => {
    const member = await sessionForRole("user");
    const role = await createGlobalRole(db, { name: "Drive only", modules: ["drive"] });
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, member.id)).run();
    expect(await meModules(member.cookie)).toEqual(["drive"]);
  });
});

describe("GET /account/users?global_role_id (FEAT-031)", () => {
  test("filters to the role's members; the default role also matches NULL", async () => {
    await backfillGlobalRoles(db);
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const assigned = await sessionForRole("user");
    const unassigned = await sessionForRole("user");
    const crew = await createGlobalRole(db, { name: "Crew", modules: ["drive"] });
    await db.update(users).set({ globalRoleId: crew.id }).where(eq(users.id, assigned.id)).run();

    const crewList = await (await app.request(`/account/users?global_role_id=${crew.id}`, { headers: { Cookie: admin.cookie } })).json() as { data: { id: string }[] };
    expect(crewList.data.map(u => u.id)).toEqual([assigned.id]);

    // The default (Guest) role buckets NULL assignments and excludes admins.
    const guest = (await resolveDefaultRole(db))!;
    const guestList = await (await app.request(`/account/users?global_role_id=${guest.id}`, { headers: { Cookie: admin.cookie } })).json() as { data: { id: string }[] };
    expect(guestList.data.map(u => u.id)).toEqual([unassigned.id]);
  });

  test("an unknown role id is a 422", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const res = await app.request("/account/users?global_role_id=missing", { headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(422);
  });
});

describe("last-admin guard (FEAT-031)", () => {
  // Through HTTP a single request can never strip the last active admin (the
  // caller is itself another active admin, self-edit is blocked, disabled
  // admins cannot authenticate) — the guard exists for the concurrent
  // mutual-demotion race, so its 409 branch is asserted at the service level.
  test("throws 409 when the target is the only active admin", async () => {
    const sole = await sessionForRole("admin");
    expect(() => assertNotLastActiveAdmin(db, sole.id)).toThrow("Cannot demote or disable the last active admin");

    // A disabled admin does not count as a survivor.
    const disabled = await sessionForRole("admin");
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)).run();
    expect(() => assertNotLastActiveAdmin(db, sole.id)).toThrow();
  });

  test("passes when another active admin remains", async () => {
    const a = await sessionForRole("admin");
    await sessionForRole("admin");
    expect(() => assertNotLastActiveAdmin(db, a.id)).not.toThrow();
  });

  test("PATCH demoting an admin succeeds while another active admin remains", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const other = await sessionForRole("admin");
    const res = await app.request(`/account/users/${other.id}`, jsonReq("PATCH", admin.cookie, { role: "user" }));
    expect(res.status).toBe(200);
  });
});
