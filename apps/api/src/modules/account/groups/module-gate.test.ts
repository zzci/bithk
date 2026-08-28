import type { AppDatabase } from "@/db";
import type { ProtectedEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createDb } from "@/db";
import { protectedRoutes } from "@/routes/protected";
import { NotFoundError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import { moduleForPath, UNGATED_PREFIXES } from "@/shared/module-manifest";
import { MODULE_KEYS, MODULES } from "@/shared/modules";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { addGroupMember, createGroup, setDefaultModules } from "./groups.service";
import { moduleGate, resolveUserModules } from "./module-gate";
// Registers the session-cookie auth provider that the gate resolves through.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-module-gate-${Date.now()}-${testNanoid()}`);
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

// Stub routers standing in for real modules: the gate keys off the path
// alone, so plain handlers behind the same `authRequired` wiring the real
// module routers use are sufficient to exercise it.
function stubRouter() {
  return () => {
    const router = new Hono<ProtectedEnv>();
    router.use("*", authRequired);
    router.get("/hr/colleagues", c => c.json({ success: true, data: [] }));
    router.get("/contacts", c => c.json({ success: true, data: [] }));
    router.get("/drive/entries", c => c.json({ success: true, data: [] }));
    router.get("/search", c => c.json({ success: true, data: [] }));
    router.get("/account/me", c => c.json({ success: true, data: {} }));
    return router;
  };
}

function gateRouter() {
  return () => {
    const router = new Hono<ProtectedEnv>();
    router.use("*", moduleGate());
    return router;
  };
}

function buildApp() {
  return mountRoutes(db, [gateRouter(), stubRouter()]);
}

/** Grant modules by putting the user into a fresh group carrying them (FEAT-032). */
async function grantModules(userId: string, modules: string[]): Promise<void> {
  const group = await createGroup(db, { name: `Group ${testNanoid()}`, modules });
  await addGroupMember(db, group.id, userId);
}

const NOT_FOUND_BODY = new NotFoundError("Route").toJSON();

describe("moduleGate", () => {
  test("a non-admin without the module gets the nonexistent-route 404 shape", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await grantModules(userId, ["contacts"]); // no hr
    const res = await buildApp().request("/hr/colleagues", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });

  test("a non-admin with the module granted through a group passes (200)", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await grantModules(userId, ["hr"]);
    const res = await buildApp().request("/hr/colleagues", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  test("hiding one module does not affect another granted one", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await grantModules(userId, ["contacts"]);
    const app = buildApp();

    const contacts = await app.request("/contacts", { headers: { Cookie: cookie } });
    expect(contacts.status).toBe(200);

    const drive = await app.request("/drive/entries", { headers: { Cookie: cookie } });
    expect(drive.status).toBe(404);
    expect(await drive.json()).toEqual(NOT_FOUND_BODY);
  });

  test("grants UNION across multiple groups", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await grantModules(userId, ["contacts"]);
    await grantModules(userId, ["drive"]);
    const app = buildApp();
    expect((await app.request("/contacts", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request("/drive/entries", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request("/hr/colleagues", { headers: { Cookie: cookie } })).status).toBe(404);
  });

  test("an admin passes on every module route", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const app = buildApp();
    for (const path of ["/hr/colleagues", "/contacts", "/drive/entries"]) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
    }
  });

  test("unclaimed paths pass through for everyone", async () => {
    const { cookie } = await sessionCookieFor(db, "user"); // no groups at all
    const app = buildApp();
    for (const path of ["/search", "/account/me"]) {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
    }
  });

  test("an unauthenticated request keeps today's 401 from authRequired", async () => {
    const res = await buildApp().request("/hr/colleagues");
    expect(res.status).toBe(401);
  });

  test("a user in no module-granting group sees no module route (visibility floor)", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const app = buildApp();
    expect((await app.request("/contacts", { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await app.request("/drive/entries", { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await app.request("/hr/colleagues", { headers: { Cookie: cookie } })).status).toBe(404);
  });

  test("an ungrouped user reaches a route granted by the Default group (FEAT-043)", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await setDefaultModules(db, ["hr"], userId);
    const app = buildApp();
    expect((await app.request("/hr/colleagues", { headers: { Cookie: cookie } })).status).toBe(200);
    // A module the Default group does not grant stays concealed.
    expect((await app.request("/contacts", { headers: { Cookie: cookie } })).status).toBe(404);
  });

  test("a grouped user is NOT lifted by the Default group (fallback only)", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    await setDefaultModules(db, ["hr"], userId);
    await grantModules(userId, ["contacts"]); // in a group → Default no longer applies
    const app = buildApp();
    expect((await app.request("/hr/colleagues", { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await app.request("/contacts", { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe("resolveUserModules", () => {
  test("admin resolves to all registered module keys", async () => {
    const { userId } = await sessionCookieFor(db, "admin");
    expect(await resolveUserModules(db, { id: userId, role: "admin" })).toEqual([...MODULE_KEYS]);
  });

  test("union over groups, deduplicated, in registry order", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    await grantModules(userId, ["hr", "documents"]);
    await grantModules(userId, ["documents", "drive"]);
    expect(await resolveUserModules(db, { id: userId, role: "user" })).toEqual(["documents", "drive", "hr"]);
  });

  test("no groups + no Default modules resolves to the empty floor", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    expect(await resolveUserModules(db, { id: userId, role: "user" })).toEqual([]);
  });

  test("an ungrouped user falls back to the Default group's modules (FEAT-043)", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    await setDefaultModules(db, ["contacts", "drive"], userId);
    // Registry order, not input order.
    expect(await resolveUserModules(db, { id: userId, role: "user" })).toEqual(["drive", "contacts"]);
  });

  test("a grouped user does NOT inherit the Default group's modules (fallback, not additive)", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    await setDefaultModules(db, ["hr"], userId);
    await grantModules(userId, ["contacts"]);
    expect(await resolveUserModules(db, { id: userId, role: "user" })).toEqual(["contacts"]);
  });

  test("a member of a grant-less group sees nothing even when Default grants modules", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    await setDefaultModules(db, ["contacts"], userId);
    await grantModules(userId, []);
    expect(await resolveUserModules(db, { id: userId, role: "user" })).toEqual([]);
  });
});

describe("moduleForPath", () => {
  test("matches exact prefixes and subpaths, not lookalike segments", () => {
    expect(moduleForPath("/hr")).toBe("hr");
    expect(moduleForPath("/hr/colleagues")).toBe("hr");
    expect(moduleForPath("/hrx")).toBeNull();
    expect(moduleForPath("/issues/abc")).toBe("projects");
    expect(moduleForPath("/search")).toBeNull();
  });
});

describe("protected router module coverage", () => {
  test("every mounted prefix is claimed by exactly one module or explicitly ungated", () => {
    const app = protectedRoutes();
    const mounted = new Set<string>();
    for (const r of (app as unknown as { routes: Array<{ path: string }> }).routes) {
      const seg = r.path.split("/")[1];
      if (!seg || seg === "*" || seg.includes("*"))
        continue;
      mounted.add(`/${seg}`);
    }
    expect(mounted.size).toBeGreaterThan(0);

    const claimCount = new Map<string, number>();
    for (const m of MODULES) {
      for (const p of m.prefixes)
        claimCount.set(p, (claimCount.get(p) ?? 0) + 1);
    }

    // A prefix must be either claimed by exactly one module or deliberately
    // allowlisted — never both, never neither.
    const violations: string[] = [];
    for (const prefix of [...mounted].sort()) {
      const claims = claimCount.get(prefix) ?? 0;
      const ungated = UNGATED_PREFIXES.includes(prefix) ? 1 : 0;
      if (claims + ungated !== 1)
        violations.push(`${prefix} (module claims=${claims}, ungated=${ungated === 1})`);
    }
    expect(violations).toEqual([]);

    // The allowlist stays honest: no stale entries for prefixes that are no
    // longer mounted, no duplicates.
    expect(new Set(UNGATED_PREFIXES).size).toBe(UNGATED_PREFIXES.length);
    for (const prefix of UNGATED_PREFIXES)
      expect(mounted.has(prefix)).toBe(true);
  });
});
