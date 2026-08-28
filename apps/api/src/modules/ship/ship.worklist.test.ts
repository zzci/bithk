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
import {
  createGlobalWorklist,
  createProjectWorklist,
  deleteGlobalWorklist,
  getGlobalWorklist,
  getProjectWorklist,
  listGlobalWorklists,
  listProjectWorklists,
  listReferenceableWorklists,
  updateGlobalWorklist,
  updateProjectWorklist,
  worklistRoutes,
} from "./ship.worklist.service";
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
  app.route("/", worklistRoutes());
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

interface TemplateBody { id: string; name: string; tags: { id: string; name: string }[]; checklist: string | null; precautions: string | null }

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

describe("global worklist KB (reads open, mutations admin-only)", () => {
  test("non-admin can read (list + detail) but cannot mutate", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const { cookie } = await sessionFor("user");

    // Seed a global so the non-admin reads see real content.
    const tpl = await dataOf<TemplateBody>(await app.request("/worklists", jsonReq("POST", admin.cookie, { name: "Readable" })));

    // Reads: any authenticated user (so a ship-manager can pick a template).
    expect((await app.request("/worklists", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request(`/worklists/${tpl.id}`, { headers: { Cookie: cookie } })).status).toBe(200);

    // Mutations stay admin-only.
    expect((await app.request("/worklists", jsonReq("POST", cookie, { name: "X" }))).status).toBe(403);
    expect((await app.request(`/worklists/${tpl.id}`, jsonReq("PATCH", cookie, { name: "Y" }))).status).toBe(403);
    expect((await app.request(`/worklists/${tpl.id}`, jsonReq("DELETE", cookie))).status).toBe(403);
  });

  test("unauthenticated is rejected with 401", async () => {
    const res = await buildApp(db).request("/worklists");
    expect(res.status).toBe(401);
  });

  test("admin performs full CRUD", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");

    const created = await app.request("/worklists", jsonReq("POST", admin.cookie, {
      name: "Engine service",
      tags: ["engine"],
      checklist: "oil; filter",
      precautions: "cool down first",
    }));
    expect(created.status).toBe(201);
    const tpl = await dataOf<TemplateBody>(created);
    expect(tpl.name).toBe("Engine service");
    expect(tpl.tags.map(t => t.name)).toEqual(["engine"]);

    const list = await app.request("/worklists", { headers: { Cookie: admin.cookie } });
    expect((await dataOf<TemplateBody[]>(list))).toHaveLength(1);

    const got = await app.request(`/worklists/${tpl.id}`, { headers: { Cookie: admin.cookie } });
    expect(got.status).toBe(200);

    const patched = await app.request(`/worklists/${tpl.id}`, jsonReq("PATCH", admin.cookie, { name: "Engine A" }));
    expect((await dataOf<TemplateBody>(patched)).name).toBe("Engine A");

    const del = await app.request(`/worklists/${tpl.id}`, jsonReq("DELETE", admin.cookie));
    expect(del.status).toBe(200);
    expect((await app.request(`/worklists/${tpl.id}`, { headers: { Cookie: admin.cookie } })).status).toBe(404);
  });

  test("rejects an empty name with 422", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    const res = await app.request("/worklists", jsonReq("POST", admin.cookie, { name: "" }));
    expect(res.status).toBe(422);
  });
});

describe("ship-level worklists: isolation from the global KB", () => {
  test("ship list returns ONLY this ship's templates, never globals", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    // Seed a global template (admin) — it must not appear in the ship list.
    await app.request("/worklists", jsonReq("POST", adminCookie, { name: "Global one" }));

    const before = await app.request(`/projects/${shipShortId}/worklists`, { headers: { Cookie: adminCookie } });
    expect(await dataOf<TemplateBody[]>(before)).toHaveLength(0);

    await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { name: "Project local" }));
    const after = await dataOf<TemplateBody[]>(await app.request(`/projects/${shipShortId}/worklists`, { headers: { Cookie: adminCookie } }));
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe("Project local");
  });

  test("copy-from-global produces an independent row; later global edits do not affect it", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);

    const global = await dataOf<TemplateBody>(await app.request("/worklists", jsonReq("POST", adminCookie, {
      name: "Hull check",
      tags: ["hull"],
      checklist: "step 1; step 2",
      precautions: "dry dock",
    })));

    const copied = await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { fromGlobalId: global.id }));
    expect(copied.status).toBe(201);
    const copy = await dataOf<TemplateBody>(copied);
    expect(copy.name).toBe("Hull check");
    expect(copy.checklist).toBe("step 1; step 2");
    expect(copy.tags.map(t => t.name)).toEqual(["hull"]); // tags copied too
    expect(copy.id).not.toBe(global.id); // a new, independent row

    // Edit the global afterwards.
    await app.request(`/worklists/${global.id}`, jsonReq("PATCH", adminCookie, { checklist: "REWRITTEN" }));

    // The ship copy is unchanged.
    const reread = await dataOf<TemplateBody>(await app.request(`/projects/${shipShortId}/worklists/${copy.id}`, { headers: { Cookie: adminCookie } }));
    expect(reread.checklist).toBe("step 1; step 2");
  });

  test("copy from a non-existent global id → 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { fromGlobalId: "missing1" }));
    expect(res.status).toBe(404);
  });

  test("create from scratch without a name → 422", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const res = await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { checklist: "x" }));
    expect(res.status).toBe(422);
  });

  // B5 regression: fromGlobalId snapshots the global row wholesale, so combining
  // it with explicit content fields is contradictory and rejected (422).
  test("rejects fromGlobalId combined with content fields → 422 (B5)", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const global = await dataOf<TemplateBody>(await app.request("/worklists", jsonReq("POST", adminCookie, { name: "Src" })));
    const res = await app.request(
      `/projects/${shipShortId}/worklists`,
      jsonReq("POST", adminCookie, { fromGlobalId: global.id, name: "Override" }),
    );
    expect(res.status).toBe(422);
  });
});

// T6: the global-knowledge-base getters guard on `isNull(projectId)`, so a
// project-level worklist (projectId set) is never reachable through the global API.
describe("global worklist getters: isNull(projectId) guard", () => {
  test("global getters never see ship-level rows, and vice versa", async () => {
    const creator = await seedUser("admin");
    const ship = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });

    const shipLevel = await createProjectWorklist(db, ship.id, { name: "Project local", tags: ["engine"] });
    expect(shipLevel.status).toBe("ok");
    const shipWorklistId = shipLevel.status === "ok" ? shipLevel.worklist.id : "";

    const global = await createGlobalWorklist(db, { name: "Global one" });

    // listGlobalWorklists returns ONLY the global row.
    const globals = await listGlobalWorklists(db);
    expect(globals).toHaveLength(1);
    expect(globals[0]!.id).toBe(global.id);

    // getGlobalWorklist refuses a ship-level id but resolves a true global id.
    expect(await getGlobalWorklist(db, shipWorklistId)).toBeUndefined();
    expect(await getGlobalWorklist(db, global.id)).toBeDefined();

    // updateGlobalWorklist / deleteGlobalWorklist are no-ops on a ship-level id.
    expect(await updateGlobalWorklist(db, shipWorklistId, { name: "Hijack" })).toBeUndefined();
    expect(await deleteGlobalWorklist(db, shipWorklistId)).toBe(false);

    // The ship-level row survives untouched.
    const survivor = await getProjectWorklist(db, ship.id, shipWorklistId);
    expect(survivor?.name).toBe("Project local");
  });
});

// The references a project may attach to a work order: its own project-level
// worklists plus the global knowledge base.
describe("listReferenceableWorklists", () => {
  test("a project with the worklist section returns its own worklists + all globals", async () => {
    const creator = await seedUser("admin");
    const ship = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });

    const shipLevel = await createProjectWorklist(db, ship.id, { name: "Project local", tags: ["engine"] });
    expect(shipLevel.status).toBe("ok");
    const g1 = await createGlobalWorklist(db, { name: "Global one" });
    const g2 = await createGlobalWorklist(db, { name: "Global two" });

    const result = await listReferenceableWorklists(db, ship.id);
    expect(result.ship.map(w => w.name)).toEqual(["Project local"]);
    expect(result.global.map(w => w.id).sort()).toEqual([g1.id, g2.id].sort());
  });

  test("a project with no worklists of its own returns ship:[] + all globals", async () => {
    const creator = await seedUser("user");
    const project = await createProject(db, { name: "Plain", creatorId: creator });
    const g = await createGlobalWorklist(db, { name: "Global only" });

    const result = await listReferenceableWorklists(db, project.id);
    expect(result.ship).toEqual([]);
    expect(result.global.map(w => w.id)).toEqual([g.id]);
  });
});

// The route moved out of the issue module and into the `worklist` section that
// owns the data (PLAN-108 §5): it is now gated by `requireSection("worklist")`
// plus project membership, so a project without the section has no such surface.
describe("GET /projects/:projectId/referenceable-worklists", () => {
  test("a member of a worklist-section project gets 200 with { ship, global }", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    const g = await createGlobalWorklist(db, { name: "Global one" });
    await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { name: "Local" }));

    const res = await app.request(`/projects/${shipShortId}/referenceable-worklists`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { ship: { name: string }[]; global: { id: string }[] } };
    expect(data.ship.map(w => w.name)).toEqual(["Local"]);
    expect(data.global.map(w => w.id)).toEqual([g.id]);
  });

  test("a project without the worklist section is 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "Plain", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/referenceable-worklists`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(res.status).toBe(404);
  });

  test("a non-member is fail-closed 404", async () => {
    const app = buildApp(db);
    const { shipShortId } = await createShipAsAdmin(app);
    const outsider = await sessionFor("user");
    const res = await app.request(`/projects/${shipShortId}/referenceable-worklists`, { headers: { Cookie: outsider.cookie } });
    expect(res.status).toBe(404);
  });

  test("an unknown project is 404", async () => {
    const app = buildApp(db);
    const { adminCookie } = await createShipAsAdmin(app);
    const res = await app.request("/projects/does-not-exist/referenceable-worklists", { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(404);
  });
});

describe("project-level worklists: authz", () => {
  test("member reads, project.manage writes, non-member gets 404", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId, baseProjectInternalId } = await createShipAsAdmin(app);

    // Admin (PM) creates a template to read.
    const tpl = await dataOf<TemplateBody>(await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { name: "T" })));

    // Plain member: can read, cannot write (403).
    const member = await seedUser("user");
    await addMember(db, baseProjectInternalId, { roleId: await memberRoleId(baseProjectInternalId), userId: member });
    const memberCookie = await cookieForUser(member);
    expect((await app.request(`/projects/${shipShortId}/worklists`, { headers: { Cookie: memberCookie } })).status).toBe(200);
    expect((await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", memberCookie, { name: "Nope" }))).status).toBe(403);
    expect((await app.request(`/projects/${shipShortId}/worklists/${tpl.id}`, jsonReq("PATCH", memberCookie, { name: "Nope" }))).status).toBe(403);
    expect((await app.request(`/projects/${shipShortId}/worklists/${tpl.id}`, jsonReq("DELETE", memberCookie))).status).toBe(403);

    // Non-member: fail-closed 404 on read and write.
    const outsider = await sessionFor("user");
    expect((await app.request(`/projects/${shipShortId}/worklists`, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
    expect((await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", outsider.cookie, { name: "Nope" }))).status).toBe(404);

    // PM (admin) writes successfully.
    expect((await app.request(`/projects/${shipShortId}/worklists/${tpl.id}`, jsonReq("PATCH", adminCookie, { name: "Renamed" }))).status).toBe(200);
    expect((await app.request(`/projects/${shipShortId}/worklists/${tpl.id}`, jsonReq("DELETE", adminCookie))).status).toBe(200);
  });
});

describe("worklist tags: sync + filtering", () => {
  test("create returns tags; update replaces; omitting tags leaves them untouched", async () => {
    const creator = await seedUser("admin");
    const ship = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });

    const created = await createProjectWorklist(db, ship.id, { name: "WL", tags: ["engine", "deck"] });
    expect(created.status).toBe("ok");
    const wlId = created.status === "ok" ? created.worklist.id : "";
    const createdTags = created.status === "ok" ? created.worklist.tags.map(t => t.name).sort() : [];
    expect(createdTags).toEqual(["deck", "engine"]);

    // Supplying tags replaces the whole set.
    const replaced = await updateProjectWorklist(db, ship.id, wlId, { tags: ["safety"] });
    expect(replaced?.tags.map(t => t.name)).toEqual(["safety"]);

    // Omitting tags leaves them untouched.
    const renamed = await updateProjectWorklist(db, ship.id, wlId, { name: "WL2" });
    expect(renamed?.name).toBe("WL2");
    expect(renamed?.tags.map(t => t.name)).toEqual(["safety"]);
  });

  test("listProjectWorklists filters by tagIds: single, multi (OR/union), unknown, empty", async () => {
    const creator = await seedUser("admin");
    const ship = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });

    await createProjectWorklist(db, ship.id, { name: "A", tags: ["engine"] });
    await createProjectWorklist(db, ship.id, { name: "B", tags: ["deck"] });
    await createProjectWorklist(db, ship.id, { name: "C", tags: ["engine", "deck"] });
    await createProjectWorklist(db, ship.id, { name: "D" });

    // Single tag → rows carrying it.
    expect((await listProjectWorklists(db, ship.id, ["engine"])).map(w => w.name).sort()).toEqual(["A", "C"]);
    // Multiple tags → OR/union.
    expect((await listProjectWorklists(db, ship.id, ["engine", "deck"])).map(w => w.name).sort()).toEqual(["A", "B", "C"]);
    // Unknown tag → empty.
    expect(await listProjectWorklists(db, ship.id, ["nope"])).toHaveLength(0);
    // Empty / omitted filter → no filter.
    expect(await listProjectWorklists(db, ship.id, [])).toHaveLength(4);
    expect(await listProjectWorklists(db, ship.id)).toHaveLength(4);
  });

  test("ship list HTTP route filters by repeated tagId= (OR)", async () => {
    const app = buildApp(db);
    const { adminCookie, shipShortId } = await createShipAsAdmin(app);
    await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { name: "A", tags: ["engine"] }));
    await app.request(`/projects/${shipShortId}/worklists`, jsonReq("POST", adminCookie, { name: "B", tags: ["deck"] }));

    const eng = await dataOf<TemplateBody[]>(await app.request(`/projects/${shipShortId}/worklists?tagId=engine`, { headers: { Cookie: adminCookie } }));
    expect(eng.map(w => w.name)).toEqual(["A"]);

    const both = await dataOf<TemplateBody[]>(await app.request(`/projects/${shipShortId}/worklists?tagId=engine&tagId=deck`, { headers: { Cookie: adminCookie } }));
    expect(both.map(w => w.name).sort()).toEqual(["A", "B"]);
  });

  test("global list HTTP route filters by repeated tagId= (OR)", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    await app.request("/worklists", jsonReq("POST", admin.cookie, { name: "GA", tags: ["x"] }));
    await app.request("/worklists", jsonReq("POST", admin.cookie, { name: "GB", tags: ["y"] }));

    const xs = await dataOf<TemplateBody[]>(await app.request("/worklists?tagId=x", { headers: { Cookie: admin.cookie } }));
    expect(xs.map(w => w.name)).toEqual(["GA"]);
  });

  test("copy-from-global copies the source's tags onto the new ship row", async () => {
    const creator = await seedUser("admin");
    const ship = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });
    const global = await createGlobalWorklist(db, { name: "Tmpl", tags: ["propulsion", "safety"] });

    const copied = await createProjectWorklist(db, ship.id, { fromGlobalId: global.id });
    expect(copied.status).toBe("ok");
    const tags = copied.status === "ok" ? copied.worklist.tags.map(t => t.name).sort() : [];
    expect(tags).toEqual(["propulsion", "safety"]);
  });
});
