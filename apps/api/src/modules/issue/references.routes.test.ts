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
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { maintenanceTemplates } from "@/modules/ship/schema";
import { createShip } from "@/modules/ship/ship.service";
import { nanoid as genNanoid } from "@/shared/lib/id";
import { errorHandler } from "@/shared/middleware/error-handler";
import { issueRoutes } from "./issue.routes";
import { createIssue } from "./issue.service";
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
    TRUST_PROXY: false,
    TRUSTED_PROXY_IPS: "",
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

async function pmRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Project Owner")!.id;
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

async function seedTemplate(shipId: string | null, name = "Annual Service"): Promise<string> {
  const id = genNanoid();
  const now = new Date().toISOString();
  await db.insert(maintenanceTemplates).values({
    id,
    shipId,
    name,
    category: "engine",
    checklist: "step 1\nstep 2",
    precautions: "wear gloves",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-issue-refs-${Date.now()}-${nanoid()}`);
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

describe("references add/list/delete", () => {
  test("issue creator adds, lists and deletes a reference", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });

    const add = await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "url", refId: "https://example.com", label: "spec" }));
    expect(add.status).toBe(201);
    const added = await add.json() as { data: { id: string; refType: string; label: string } };
    expect(added.data.refType).toBe("url");
    expect(added.data.label).toBe("spec");

    const list = await app.request(`/issues/${issue.id}/references`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const listed = await list.json() as { data: Array<{ id: string }> };
    expect(listed.data).toHaveLength(1);

    const del = await app.request(`/issues/${issue.id}/references/${added.data.id}`, jsonReq("DELETE", cookie));
    expect(del.status).toBe(200);
    const after = await app.request(`/issues/${issue.id}/references`, { headers: { Cookie: cookie } });
    expect((await after.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  test("deleting an unknown reference is 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const del = await app.request(`/issues/${issue.id}/references/nope`, jsonReq("DELETE", cookie));
    expect(del.status).toBe(404);
  });

  test("validation rejects an unknown refType", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const add = await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "bogus", refId: "x" }));
    expect(add.status).toBe(422);
  });
});

describe("references authz (reuses the issue gate)", () => {
  test("a non-member gets a fail-closed 404 on list and add", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const cookie = await cookieForUser(outsider);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });

    expect((await app.request(`/issues/${issue.id}/references`, { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "url", refId: "x" }))).status).toBe(404);
  });

  test("a plain member can read but cannot add (403)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const member = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { userId: member, roleId: await memberRoleId(project.id) });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const cookie = await cookieForUser(member);

    expect((await app.request(`/issues/${issue.id}/references`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "url", refId: "x" }))).status).toBe(403);
  });

  test("a project manager (issue.manage) who is not the creator can add", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const pm = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { userId: pm, roleId: await pmRoleId(project.id) });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const add = await app.request(`/issues/${issue.id}/references`, jsonReq("POST", await cookieForUser(pm), { refType: "url", refId: "x" }));
    expect(add.status).toBe(201);
  });

  test("an app admin bypasses membership", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const add = await app.request(`/issues/${issue.id}/references`, jsonReq("POST", await cookieForUser(admin), { refType: "url", refId: "x" }));
    expect(add.status).toBe(201);
  });

  test("references on a missing issue are 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const res = await app.request(`/issues/missing01/references`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(res.status).toBe(404);
  });
});

describe("issue create with references[]", () => {
  test("references supplied at create time are persisted", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const templateId = await seedTemplate(null);

    const create = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", cookie, {
      title: "Service the engine",
      references: [{ refType: "maintenance_template", refId: templateId }],
    }));
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };

    const list = await app.request(`/issues/${created.data.id}/references`, { headers: { Cookie: cookie } });
    const listed = await list.json() as { data: Array<{ refType: string; template: { name: string } | null }> };
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]!.refType).toBe("maintenance_template");
    expect(listed.data[0]!.template?.name).toBe("Annual Service");
  });

  test("create without references behaves unchanged", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const create = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", cookie, { title: "Plain" }));
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };
    const list = await app.request(`/issues/${created.data.id}/references`, { headers: { Cookie: cookie } });
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(0);
  });
});

describe("maintenance_template resolution", () => {
  test("resolves checklist + precautions, degrades gracefully on a dangling refId", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const templateId = await seedTemplate(null);

    await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "maintenance_template", refId: templateId }));
    await app.request(`/issues/${issue.id}/references`, jsonReq("POST", cookie, { refType: "maintenance_template", refId: "deleted-template-id" }));

    const list = await app.request(`/issues/${issue.id}/references`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const data = (await list.json() as { data: Array<{ refId: string; template: { checklist: string; precautions: string } | null }> }).data;
    const resolved = data.find(r => r.refId === templateId)!;
    const dangling = data.find(r => r.refId === "deleted-template-id")!;
    expect(resolved.template?.checklist).toBe("step 1\nstep 2");
    expect(resolved.template?.precautions).toBe("wear gloves");
    expect(dangling.template).toBeNull();
  });
});

describe("ship maintenance work orders", () => {
  test("lists issues in a ship's bound projects carrying a maintenance_template ref", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const cookie = await cookieForUser(owner);
    const ship = await createShip(db, { name: "Aurora", creatorId: owner });
    const templateId = await seedTemplate(ship.id);

    // A maintenance work order in the ship's base project.
    const issue = await createIssue(db, {
      title: "Quarterly check",
      creatorId: owner,
      projectId: ship.baseProjectId!,
      references: [{ refType: "maintenance_template", refId: templateId }],
    });
    // A plain issue (no maintenance ref) in the same project — must be excluded.
    await createIssue(db, { title: "Plain", creatorId: owner, projectId: ship.baseProjectId! });

    const res = await app.request(`/ships/${ship.shortId}/maintenance-orders`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const data = (await res.json() as { data: Array<{ id: string; templateRefId: string }> }).data;
    expect(data).toHaveLength(1);
    expect(data[0]!.id).toBe(issue.id);
    expect(data[0]!.templateRefId).toBe(templateId);
  });

  test("a non-member gets a fail-closed 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const ship = await createShip(db, { name: "Aurora", creatorId: owner });
    const res = await app.request(`/ships/${ship.shortId}/maintenance-orders`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(res.status).toBe(404);
  });
});
