import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { mountRoutes, seedUser, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { roleRoutes } from "./roles.routes";
import { backfillGlobalRoles, resolveDefaultRole } from "./roles.service";
// Registers the session-cookie auth provider that `authRequired` resolves through.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [roleRoutes]);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-global-roles-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  await backfillGlobalRoles(db);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

async function adminCookie() {
  const { cookie } = await sessionCookieFor(db, "admin");
  return cookie;
}

function jsonInit(method: string, cookie: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify(body),
  };
}

describe("auth/admin gating", () => {
  test("GET /global-roles → 401 without a session", async () => {
    const res = await buildApp().request("/global-roles");
    expect(res.status).toBe(401);
  });

  test("GET /global-roles → 403 for a non-admin user", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request("/global-roles", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});

describe("global roles CRUD", () => {
  test("create, list, update, delete happy path", async () => {
    const cookie = await adminCookie();
    const app = buildApp();

    const created = await app.request("/global-roles", jsonInit("POST", cookie, { name: "Crew", modules: ["drive", "ships"] }));
    expect(created.status).toBe(201);
    const role = (await created.json() as { data: { id: string; modules: string[]; isSystem: boolean } }).data;
    expect(role.modules).toEqual(["drive", "ships"]);
    expect(role.isSystem).toBe(false);

    const list = await app.request("/global-roles", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const names = (await list.json() as { data: Array<{ name: string }> }).data.map(r => r.name);
    expect(names).toContain("Guest");
    expect(names).toContain("Crew");

    const patched = await app.request(`/global-roles/${role.id}`, jsonInit("PATCH", cookie, { name: "Deck crew", modules: ["drive"] }));
    expect(patched.status).toBe(200);
    const updated = (await patched.json() as { data: { name: string; modules: string[] } }).data;
    expect(updated.name).toBe("Deck crew");
    expect(updated.modules).toEqual(["drive"]);

    const deleted = await app.request(`/global-roles/${role.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(deleted.status).toBe(200);

    const after = await app.request("/global-roles", { headers: { Cookie: cookie } });
    const remaining = (await after.json() as { data: Array<{ name: string }> }).data.map(r => r.name);
    expect(remaining).not.toContain("Deck crew");
  });

  test("the default Guest role can be neither deleted nor modified", async () => {
    const cookie = await adminCookie();
    const app = buildApp();
    const defaultRole = (await resolveDefaultRole(db))!;

    const del = await app.request(`/global-roles/${defaultRole.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(403);

    const patch = await app.request(`/global-roles/${defaultRole.id}`, jsonInit("PATCH", cookie, { modules: ["documents"] }));
    expect(patch.status).toBe(403);
  });

  test("list carries per-role user counts; NULL assignments bucket to Guest; admins excluded", async () => {
    const cookie = await adminCookie(); // creates one admin user
    const app = buildApp();

    const created = await app.request("/global-roles", jsonInit("POST", cookie, { name: "Crew", modules: ["drive"] }));
    const crew = (await created.json() as { data: { id: string } }).data;

    await seedUser(db, "user"); // NULL globalRoleId → buckets to Guest
    const assigned = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: crew.id }).where(eq(users.id, assigned)).run();

    const list = await app.request("/global-roles", { headers: { Cookie: cookie } });
    const data = (await list.json() as { data: Array<{ name: string; kind: string | null; userCount: number }> }).data;
    const byName = new Map(data.map(r => [r.name, r]));
    expect(byName.get("Guest")!.userCount).toBe(1);
    expect(byName.get("Crew")!.userCount).toBe(1);
  });

  test("rejects unknown module keys with 422", async () => {
    const cookie = await adminCookie();
    const res = await buildApp().request("/global-roles", jsonInit("POST", cookie, { name: "Bad", modules: ["finance"] }));
    expect(res.status).toBe(422);
  });

  test("rejects a duplicate role name with 409", async () => {
    const cookie = await adminCookie();
    const app = buildApp();
    const first = await app.request("/global-roles", jsonInit("POST", cookie, { name: "Crew", modules: [] }));
    expect(first.status).toBe(201);
    const dup = await app.request("/global-roles", jsonInit("POST", cookie, { name: "Crew", modules: [] }));
    expect(dup.status).toBe(409);

    // Renaming onto an existing name is rejected too.
    const role = (await first.json() as { data: { id: string } }).data;
    const rename = await app.request(`/global-roles/${role.id}`, jsonInit("PATCH", cookie, { name: "Guest" }));
    expect(rename.status).toBe(409);
  });

  test("PATCH an unknown role → 404", async () => {
    const cookie = await adminCookie();
    const res = await buildApp().request("/global-roles/nope", jsonInit("PATCH", cookie, { name: "X" }));
    expect(res.status).toBe(404);
  });
});
