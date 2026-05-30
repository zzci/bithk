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
import { issueRoutes } from "@/modules/issue";
import { createIssue } from "@/modules/issue/issue.service";
import { itemRoutes } from "@/modules/item";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { procurementRoutes } from "@/modules/procurement";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { createRole, listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { errorHandler } from "@/shared/middleware/error-handler";
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
    LOG_LEVEL: "info",
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
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
  app.route("/", issueRoutes());
  app.route("/", procurementRoutes());
  app.route("/", itemRoutes());
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

async function cookieForUser(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Member")!.id;
}

async function addMemberWithCaps(projectId: string, userId: string, caps: string[]): Promise<void> {
  const role = await createRole(db, projectId, { name: `role-${nanoid()}`, capabilities: caps });
  await addMember(db, projectId, { roleId: role.id, userId });
}

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-pin-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("issue pin / unpin", () => {
  test("pin sets pinned + pinnedAt; unpin clears pinnedAt", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "Fix pump", projectId: project.id, creatorId: owner });

    const pinned = await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", cookie));
    expect(pinned.status).toBe(200);
    const pinnedBody = await pinned.json();
    expect(pinnedBody.data.pinned).toBe(true);
    expect(typeof pinnedBody.data.pinnedAt).toBe("string");
    expect(pinnedBody.data.pinnedAt.length).toBeGreaterThan(0);

    const unpinned = await app.request(`/projects/${project.shortId}/issues/${issue.id}/unpin`, jsonReq("POST", cookie));
    expect(unpinned.status).toBe(200);
    const unpinnedBody = await unpinned.json();
    expect(unpinnedBody.data.pinned).toBe(false);
    expect(unpinnedBody.data.pinnedAt).toBeNull();
  });

  test("a plain member who is not the creator and lacks issue.manage cannot pin (403)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const plain = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: plain });
    const issue = await createIssue(db, { title: "Fix pump", projectId: project.id, creatorId: owner });

    const res = await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", await cookieForUser(plain)));
    expect(res.status).toBe(403);
  });

  test("a member with issue.manage can pin", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const manager = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, manager, ["issue.manage"]);
    const issue = await createIssue(db, { title: "Fix pump", projectId: project.id, creatorId: owner });

    const res = await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", await cookieForUser(manager)));
    expect(res.status).toBe(200);
    expect((await res.json()).data.pinned).toBe(true);
  });
});

describe("procurement pin / unpin", () => {
  test("the pm can pin (sets pinnedAt) and unpin (clears it)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Steel", creatorId: owner });

    const pinned = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/pin`, jsonReq("POST", cookie));
    expect(pinned.status).toBe(200);
    const pinnedBody = await pinned.json();
    expect(pinnedBody.data.pinned).toBe(true);
    expect(typeof pinnedBody.data.pinnedAt).toBe("string");

    const unpinned = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/unpin`, jsonReq("POST", cookie));
    expect(unpinned.status).toBe(200);
    const unpinnedBody = await unpinned.json();
    expect(unpinnedBody.data.pinned).toBe(false);
    expect(unpinnedBody.data.pinnedAt).toBeNull();
  });

  test("a view-only member (no procurement.manage) cannot pin (fail-closed 404)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const viewer = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, viewer, ["procurement.view"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Steel", creatorId: owner });

    const res = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/pin`, jsonReq("POST", await cookieForUser(viewer)));
    expect(res.status).toBe(404);
  });
});

describe("pinned-list (GET /projects/:projectId/pinned-items)", () => {
  test("returns the mixed pinned set ordered by pinnedAt DESC", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "Fix pump", projectId: project.id, creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Steel", creatorId: owner });

    // Pin the issue first, then the procurement, with a gap so pinnedAt differs.
    await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", cookie));
    await Bun.sleep(5);
    await app.request(`/projects/${project.shortId}/procurements/${proc.id}/pin`, jsonReq("POST", cookie));

    const res = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    // Most-recently-pinned first → procurement, then issue.
    expect(body.data[0].type).toBe("procurement");
    expect(body.data[0].shortId).toBe(proc.id);
    expect(body.data[1].type).toBe("issue");
    expect(body.data[1].shortId).toBe(issue.id);
    // Entry shape carries enough to render the Pin area.
    expect(body.data[0]).toMatchObject({ title: "Steel", status: "requested" });
    expect(typeof body.data[0].id).toBe("string");
    expect(typeof body.data[0].pinnedAt).toBe("string");
  });

  test("excludes soft-irrelevant types: only pinned rows are returned", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "Pinned", projectId: project.id, creatorId: owner });
    await createIssue(db, { title: "Unpinned", projectId: project.id, creatorId: owner });

    await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", cookie));

    const res = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].shortId).toBe(issue.id);
  });

  test("procurement visibility is respected: a member without procurement.view sees only pinned issues", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const ownerCookie = await cookieForUser(owner);
    const plain = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: plain });
    const issue = await createIssue(db, { title: "Fix pump", projectId: project.id, creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Steel", creatorId: owner });

    await app.request(`/projects/${project.shortId}/issues/${issue.id}/pin`, jsonReq("POST", ownerCookie));
    await app.request(`/projects/${project.shortId}/procurements/${proc.id}/pin`, jsonReq("POST", ownerCookie));

    // Owner (pm, has procurement.view) sees both.
    const ownerView = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: ownerCookie } });
    expect((await ownerView.json()).data).toHaveLength(2);

    // Plain member lacks procurement.view → only the pinned issue.
    const plainView = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: await cookieForUser(plain) } });
    const plainBody = await plainView.json();
    expect(plainBody.data).toHaveLength(1);
    expect(plainBody.data[0].type).toBe("issue");
  });

  test("a non-member is fail-closed 404; an app admin sees everything", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Steel", creatorId: owner });
    await app.request(`/projects/${project.shortId}/procurements/${proc.id}/pin`, jsonReq("POST", await cookieForUser(owner)));

    const out = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(out.status).toBe(404);

    const adminRes = await app.request(`/projects/${project.shortId}/pinned-items`, { headers: { Cookie: await cookieForUser(admin) } });
    expect(adminRes.status).toBe(200);
    expect((await adminRes.json()).data).toHaveLength(1);
  });
});
