import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { createRole, listRoles } from "./project.roles";
import { projectRoutes } from "./project.routes";
import { addMember, createProject } from "./project.service";
// Registers the session-cookie auth provider that `authRequired` resolves
// through — without it the middleware throws.
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
    CORS_ORIGIN: undefined,
    TRUST_PROXY: false,
    TRUSTED_PROXY_IPS: "",
    CRON_ENABLED: false,
    CRON_ACTIONS_ENABLED: [],
    HTTP_ACTION_ALLOW_PRIVATE: false,
    HTTP_ACTION_TIMEOUT_SECONDS: 30,
    SHELL_ACTION_TIMEOUT_SECONDS: 300,
    OAUTH_CLIENT_ID: undefined,
    OAUTH_CLIENT_SECRET: undefined,
    OAUTH_ISSUER: undefined,
    OAUTH_AUTHORIZE_URL: undefined,
    OAUTH_TOKEN_URL: undefined,
    OAUTH_USERINFO_URL: undefined,
    OAUTH_PKCE: true,
    SESSION_MAX_AGE: 86400,
    AUDIT_RETENTION_DAYS: 0,
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_LOCAL_ROOT: "data/uploads/files",
    FILE_GC_MODE: "async",
    FILE_GC_INTERVAL_SECONDS: 3600,
    FILE_PRESIGN_ENABLED: true,
    FILE_PRESIGN_TTL_SECONDS: 300,
    DEFAULT_ADMIN: "",
    SINGLE_USER_MODE: false,
    SINGLE_USER_USERNAME: undefined,
    SINGLE_USER_PASSWORD_HASH: undefined,
    SINGLE_USER_PASSWORD_HASH_FILE: undefined,
    SINGLE_USER_NAME: undefined,
    SINGLE_USER_EMAIL: undefined,
    APP_URL: undefined,
    OIDC_LOGOUT_URL: undefined,
    SERVICE_TOKEN_METRICS: undefined,
    SERVICE_TOKEN_BACKUP: undefined,
    BACKUP_EXPORT_MIN_INTERVAL_SECONDS: 0,
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
  app.route("/", projectRoutes());
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

/** Seed a user + a live session and return its Cookie header. */
async function sessionFor(role: "admin" | "user" = "user"): Promise<{ userId: string; cookie: string }> {
  const userId = await seedUser(role);
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return { userId, cookie: `session_id=${sessionId}` };
}

/** Issue a live session for an existing user id. */
async function cookieForUser(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Member")!.id;
}

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-project-routes-${Date.now()}-${nanoid()}`);
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

describe("auth gating", () => {
  test("GET /projects → 401 without a session", async () => {
    const res = await buildApp(db).request("/projects");
    expect(res.status).toBe(401);
  });

  test("POST /projects → 403 for a non-admin user", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("user");
    const res = await app.request("/projects", jsonReq("POST", cookie, { name: "P" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /projects (admin only)", () => {
  test("admin creates a project and becomes its pm member", async () => {
    const app = buildApp(db);
    const { userId, cookie } = await sessionFor("admin");
    const res = await app.request("/projects", jsonReq("POST", cookie, { name: "Bridge", tags: ["a"] }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; name: string; tags: { name: string }[] } };
    expect(body.data.name).toBe("Bridge");
    expect(body.data.tags.map(t => t.name)).toEqual(["a"]);

    // The creator can read the project as its pm.
    const detail = await app.request(`/projects/${body.data.id}`, { headers: { Cookie: await cookieForUser(userId) } });
    expect(detail.status).toBe(200);
  });

  test("rejects an empty name with 422", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    const res = await app.request("/projects", jsonReq("POST", cookie, { name: "" }));
    expect(res.status).toBe(422);
  });
});

describe("GET /projects (list scoping)", () => {
  test("a non-admin sees only the projects they belong to; admin sees all", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await sessionFor("user");
    const admin = await sessionFor("admin");
    await createProject(db, { name: "Owned", creatorId: owner });

    const mineRes = await app.request("/projects", { headers: { Cookie: await cookieForUser(owner) } });
    expect((await mineRes.json() as { meta: { total: number } }).meta.total).toBe(1);

    const theirsRes = await app.request("/projects", { headers: { Cookie: outsider.cookie } });
    expect((await theirsRes.json() as { meta: { total: number } }).meta.total).toBe(0);

    const adminRes = await app.request("/projects", { headers: { Cookie: admin.cookie } });
    expect((await adminRes.json() as { meta: { total: number } }).meta.total).toBe(1);
  });

  test("archived projects are hidden unless explicitly filtered", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    await createProject(db, { name: "Live", status: "active", creatorId: admin.userId });
    await createProject(db, { name: "Old", status: "archived", creatorId: admin.userId });

    const def = await app.request("/projects", { headers: { Cookie: admin.cookie } });
    expect((await def.json() as { data: { name: string }[] }).data.map(p => p.name)).toEqual(["Live"]);

    const arch = await app.request("/projects?status=archived", { headers: { Cookie: admin.cookie } });
    expect((await arch.json() as { data: { name: string }[] }).data.map(p => p.name)).toEqual(["Old"]);
  });

  test("an invalid status filter is rejected with 422", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    const res = await app.request("/projects?status=bogus", { headers: { Cookie: cookie } });
    expect(res.status).toBe(422);
  });
});

describe("GET /projects/:id (detail + fail-closed)", () => {
  test("a member reads detail with their capability set; the pm has project.manage", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { capabilities: string[] } };
    expect(body.data.capabilities).toContain("project.manage");
  });

  test("a non-member gets a fail-closed 404 (membership not leaked)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await sessionFor("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}`, { headers: { Cookie: outsider.cookie } });
    expect(res.status).toBe(404);
  });

  test("an unknown project id is 404", async () => {
    const app = buildApp(db);
    const { cookie } = await sessionFor("admin");
    const res = await app.request("/projects/missing0", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("an app admin bypasses membership and reads any project with the full capability set", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const admin = await sessionFor("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}`, { headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { capabilities: string[] } };
    expect(body.data.capabilities).toContain("project.manage");
    expect(body.data.capabilities).toContain("procurement.manage");
  });
});

describe("PATCH / DELETE /projects/:id (project.manage gate)", () => {
  test("a plain member cannot update; the pm can", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });

    const denied = await app.request(`/projects/${project.shortId}`, jsonReq("PATCH", await cookieForUser(bob), { name: "X" }));
    expect(denied.status).toBe(403);

    const ok = await app.request(`/projects/${project.shortId}`, jsonReq("PATCH", await cookieForUser(owner), { name: "X" }));
    expect(ok.status).toBe(200);
    expect((await ok.json() as { data: { name: string } }).data.name).toBe("X");
  });

  test("PATCH with no fields is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}`, jsonReq("PATCH", await cookieForUser(owner), {}));
    expect(res.status).toBe(422);
  });

  test("the pm soft-deletes; the project then 404s", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const del = await app.request(`/projects/${project.shortId}`, jsonReq("DELETE", await cookieForUser(owner)));
    expect(del.status).toBe(200);
    const after = await app.request(`/projects/${project.shortId}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(after.status).toBe(404);
  });
});

describe("members (members.manage gate)", () => {
  test("a plain member cannot add members; the pm can, and duplicates 409", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const carol = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const roleId = await memberRoleId(project.id);
    await addMember(db, project.id, { roleId, userId: bob });

    const denied = await app.request(`/projects/${project.shortId}/members`, jsonReq("POST", await cookieForUser(bob), { roleId, userId: carol }));
    expect(denied.status).toBe(403);

    const added = await app.request(`/projects/${project.shortId}/members`, jsonReq("POST", await cookieForUser(owner), { roleId, userId: carol }));
    expect(added.status).toBe(201);

    const dup = await app.request(`/projects/${project.shortId}/members`, jsonReq("POST", await cookieForUser(owner), { roleId, userId: carol }));
    expect(dup.status).toBe(409);
  });

  test("a member with no userId and no displayName is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const roleId = await memberRoleId(project.id);
    const res = await app.request(`/projects/${project.shortId}/members`, jsonReq("POST", await cookieForUser(owner), { roleId }));
    expect(res.status).toBe(422);
  });

  test("adding a member with a role from another project is rejected (422)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const other = await createProject(db, { name: "Other", creatorId: owner });
    const foreignRole = await memberRoleId(other.id);
    const res = await app.request(`/projects/${project.shortId}/members`, jsonReq("POST", await cookieForUser(owner), { roleId: foreignRole, userId: bob }));
    expect(res.status).toBe(422);
  });

  test("update and remove a member; removing a missing member 404s", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const roleId = await memberRoleId(project.id);
    const member = await addMember(db, project.id, { roleId, userId: bob });
    const cookie = await cookieForUser(owner);

    const patched = await app.request(`/projects/${project.shortId}/members/${member.id}`, jsonReq("PATCH", cookie, { title: "Lead" }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { data: { title: string } }).data.title).toBe("Lead");

    const removed = await app.request(`/projects/${project.shortId}/members/${member.id}`, jsonReq("DELETE", cookie));
    expect(removed.status).toBe(200);

    const again = await app.request(`/projects/${project.shortId}/members/${member.id}`, jsonReq("DELETE", cookie));
    expect(again.status).toBe(404);
  });
});

describe("roles (roles.manage gate)", () => {
  test("the pm creates/lists/updates roles; a plain member is fail-closed on detail (404 project)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await sessionFor("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const created = await app.request(`/projects/${project.shortId}/roles`, jsonReq("POST", cookie, { name: "QA", capabilities: ["issue.manage"] }));
    expect(created.status).toBe(201);
    const role = (await created.json() as { data: { id: string; capabilities: string[] } }).data;
    expect(role.capabilities).toEqual(["issue.manage"]);

    const list = await app.request(`/projects/${project.shortId}/roles`, { headers: { Cookie: cookie } });
    expect((await list.json() as { data: unknown[] }).data.length).toBe(3); // pm + member + QA

    // A non-member is fail-closed at the project gate.
    const outside = await app.request(`/projects/${project.shortId}/roles`, { headers: { Cookie: outsider.cookie } });
    expect(outside.status).toBe(404);
  });

  test("the pm renames a custom role and edits its capabilities", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);
    const role = await createRole(db, project.id, { name: "QA", capabilities: ["issue.manage"] });

    const res = await app.request(`/projects/${project.shortId}/roles/${role.id}`, jsonReq("PATCH", cookie, { name: "Reviewer", capabilities: ["procurement.view"] }));
    expect(res.status).toBe(200);
    const body = (await res.json() as { data: { name: string; capabilities: string[] } }).data;
    expect(body.name).toBe("Reviewer");
    expect(body.capabilities).toEqual(["procurement.view"]);
  });

  test("a system role is capability-locked: a PATCH is a no-op that keeps the full set", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);
    const pmRole = (await listRoles(db, project.id)).find(r => r.isSystem === 1)!;

    const res = await app.request(`/projects/${project.shortId}/roles/${pmRole.id}`, jsonReq("PATCH", cookie, { capabilities: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json() as { data: { isSystem: boolean; capabilities: string[] } }).data;
    expect(body.isSystem).toBe(true);
    expect(body.capabilities).toContain("project.manage");
  });

  test("patching an unknown role 404s", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/roles/missing0`, jsonReq("PATCH", await cookieForUser(owner), { name: "X" }));
    expect(res.status).toBe(404);
  });

  test("a system role cannot be deleted (403); an in-use role cannot (422); an unused role can", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);
    const pmRole = (await listRoles(db, project.id)).find(r => r.isSystem === 1)!;

    const sys = await app.request(`/projects/${project.shortId}/roles/${pmRole.id}`, jsonReq("DELETE", cookie));
    expect(sys.status).toBe(403);

    const inUse = await createRole(db, project.id, { name: "Busy", capabilities: [] });
    await addMember(db, project.id, { roleId: inUse.id, userId: bob });
    const busy = await app.request(`/projects/${project.shortId}/roles/${inUse.id}`, jsonReq("DELETE", cookie));
    expect(busy.status).toBe(422);

    const free = await createRole(db, project.id, { name: "Free", capabilities: [] });
    const ok = await app.request(`/projects/${project.shortId}/roles/${free.id}`, jsonReq("DELETE", cookie));
    expect(ok.status).toBe(200);
  });
});

describe("procurement categories (categories.manage gate)", () => {
  test("pm CRUDs a category; a plain member cannot create", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const cookie = await cookieForUser(owner);

    const denied = await app.request(`/projects/${project.shortId}/procurement-categories`, jsonReq("POST", await cookieForUser(bob), { name: "Materials" }));
    expect(denied.status).toBe(403);

    const created = await app.request(`/projects/${project.shortId}/procurement-categories`, jsonReq("POST", cookie, { name: "Materials", code: "MAT" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: { id: string } }).data;

    const patched = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("PATCH", cookie, { name: "Raw materials" }));
    expect((await patched.json() as { data: { name: string } }).data.name).toBe("Raw materials");

    const removed = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("DELETE", cookie));
    expect(removed.status).toBe(200);

    const missing = await app.request(`/projects/${project.shortId}/procurement-categories/${cat.id}`, jsonReq("DELETE", cookie));
    expect(missing.status).toBe(404);
  });
});

describe("GET /tags", () => {
  test("lists the global tag vocabulary for any authenticated user", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    await createProject(db, { name: "P", creatorId: owner, tags: ["alpha", "beta"] });
    const res = await app.request("/tags", { headers: { Cookie: await cookieForUser(owner) } });
    expect(res.status).toBe(200);
    const names = (await res.json() as { data: { name: string }[] }).data.map(t => t.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});

describe("tag admin (admin only)", () => {
  test("a non-admin cannot mutate tags; an admin can create/rename/delete", async () => {
    const app = buildApp(db);
    const user = await sessionFor("user");
    const admin = await sessionFor("admin");

    const denied = await app.request("/tags", jsonReq("POST", user.cookie, { name: "X" }));
    expect(denied.status).toBe(403);

    const created = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Coastal" }));
    expect(created.status).toBe(201);
    const tag = (await created.json() as { data: { id: string; name: string } }).data;
    expect(tag.name).toBe("Coastal");

    const renamed = await app.request(`/tags/${tag.id}`, jsonReq("PATCH", admin.cookie, { name: "Offshore" }));
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { data: { name: string } }).data.name).toBe("Offshore");

    const removed = await app.request(`/tags/${tag.id}`, jsonReq("DELETE", admin.cookie));
    expect(removed.status).toBe(200);

    const missing = await app.request(`/tags/${tag.id}`, jsonReq("DELETE", admin.cookie));
    expect(missing.status).toBe(404);
  });

  test("a duplicate tag name is rejected with 422", async () => {
    const app = buildApp(db);
    const admin = await sessionFor("admin");
    await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Dup" }));
    const res = await app.request("/tags", jsonReq("POST", admin.cookie, { name: "Dup" }));
    expect(res.status).toBe(422);
  });
});

describe("global procurement categories (admin only)", () => {
  test("a non-admin is blocked; an admin CRUDs the global set", async () => {
    const app = buildApp(db);
    const user = await sessionFor("user");
    const admin = await sessionFor("admin");

    const denied = await app.request("/global-procurement-categories", jsonReq("POST", user.cookie, { name: "X" }));
    expect(denied.status).toBe(403);
    const deniedList = await app.request("/global-procurement-categories", { headers: { Cookie: user.cookie } });
    expect(deniedList.status).toBe(403);

    const created = await app.request("/global-procurement-categories", jsonReq("POST", admin.cookie, { name: "Engine", code: "ENG" }));
    expect(created.status).toBe(201);
    const cat = (await created.json() as { data: { id: string } }).data;

    const list = await app.request("/global-procurement-categories", { headers: { Cookie: admin.cookie } });
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(1);

    const patched = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("PATCH", admin.cookie, { name: "Engine room" }));
    expect((await patched.json() as { data: { name: string } }).data.name).toBe("Engine room");

    const removed = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("DELETE", admin.cookie));
    expect(removed.status).toBe(200);
    const missing = await app.request(`/global-procurement-categories/${cat.id}`, jsonReq("DELETE", admin.cookie));
    expect(missing.status).toBe(404);
  });
});
