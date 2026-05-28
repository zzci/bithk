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
  const dir = resolve(tmpdir(), `test-issue-routes-${Date.now()}-${nanoid()}`);
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

describe("auth + membership gating", () => {
  test("GET issues → 401 without a session", async () => {
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await buildApp(db).request(`/projects/${project.shortId}/issues`);
    expect(res.status).toBe(401);
  });

  test("a non-member listing a project's issues is fail-closed 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/issues`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(res.status).toBe(404);
  });

  test("an app admin lists issues for a project they do not belong to", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const res = await app.request(`/projects/${project.shortId}/issues`, { headers: { Cookie: await cookieForUser(admin) } });
    expect(res.status).toBe(200);
    expect((await res.json() as { meta: { total: number } }).meta.total).toBe(1);
  });
});

describe("POST issues (create)", () => {
  test("a member creates an issue (201)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", await cookieForUser(owner), { title: "Fix it", priority: "high" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { title: string; status: string } };
    expect(body.data.title).toBe("Fix it");
    expect(body.data.status).toBe("open");
  });

  test("a non-member cannot create (fail-closed 404)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", await cookieForUser(outsider), { title: "X" }));
    expect(res.status).toBe(404);
  });

  test("assigning a member from another project is rejected (404)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const other = await createProject(db, { name: "Other", creatorId: owner });
    const foreign = await addMember(db, other.id, { roleId: await memberRoleId(other.id), userId: bob });
    const res = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", await cookieForUser(owner), { title: "X", assigneeMemberId: foreign.id }));
    expect(res.status).toBe(404);
  });

  test("an empty title is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/issues`, jsonReq("POST", await cookieForUser(owner), { title: "" }));
    expect(res.status).toBe(422);
  });
});

describe("GET issue detail (cross-project scoping)", () => {
  test("a member reads detail; a non-member 404s; an issue from another project 404s", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const other = await createProject(db, { name: "Other", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });

    const ok = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(ok.status).toBe(200);

    const denied = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(denied.status).toBe(404);

    // Same issue id, wrong project path → 404 (issue does not belong to it).
    const wrongProject = await app.request(`/projects/${other.shortId}/issues/${issue.id}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(wrongProject.status).toBe(404);
  });
});

describe("PATCH issue (field-level permissions)", () => {
  test("the pm/creator can edit every field", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const res = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("PATCH", await cookieForUser(owner), { title: "T2", priority: "urgent" }));
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { title: string } }).data.title).toBe("T2");
  });

  test("a member assignee may change status but not other fields", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const member = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id, assigneeMemberId: member.id });
    const cookie = await cookieForUser(bob);

    const statusOk = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("PATCH", cookie, { status: "in_progress" }));
    expect(statusOk.status).toBe(200);
    expect((await statusOk.json() as { data: { status: string } }).data.status).toBe("in_progress");

    const titleDenied = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("PATCH", cookie, { title: "hijack" }));
    expect(titleDenied.status).toBe(403);
  });

  test("a plain member who is neither creator nor assignee cannot edit (403)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const res = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("PATCH", await cookieForUser(bob), { status: "done" }));
    expect(res.status).toBe(403);
  });
});

describe("DELETE issue", () => {
  test("a plain member cannot delete; the pm can; admin can", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });

    const denied = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("DELETE", await cookieForUser(bob)));
    expect(denied.status).toBe(403);

    const ok = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, jsonReq("DELETE", await cookieForUser(owner)));
    expect(ok.status).toBe(200);

    // Now gone.
    const gone = await app.request(`/projects/${project.shortId}/issues/${issue.id}`, { headers: { Cookie: await cookieForUser(admin) } });
    expect(gone.status).toBe(404);
  });
});

// Original global issue detail exposed comments and attachments off the issue.
// Under the project-scoped model the same surfaces must remain reachable through
// `/projects/:projectId/issues/:id/...`, gated by project membership.
describe("detail comments + attachments (project-scoped path)", () => {
  test("a member posts/lists comments and lists attachments through the project-scoped path", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const bob = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const base = `/projects/${project.shortId}/issues/${issue.id}`;
    const cookie = await cookieForUser(bob);

    const posted = await app.request(`${base}/comments`, jsonReq("POST", cookie, { content: "hello" }));
    expect(posted.status).toBe(201);
    const postedBody = await posted.json() as { data: { id: string; content: string } };
    expect(postedBody.data.content).toBe("hello");

    const listed = await app.request(`${base}/comments`, { headers: { Cookie: cookie } });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as { data: Array<{ id: string }> };
    expect(listedBody.data.some(c => c.id === postedBody.data.id)).toBe(true);

    const attachments = await app.request(`${base}/attachments`, { headers: { Cookie: cookie } });
    expect(attachments.status).toBe(200);
    expect((await attachments.json() as { data: unknown[] }).data).toEqual([]);
  });

  test("a non-member is fail-closed 404 on the comments path", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const issue = await createIssue(db, { title: "T", creatorId: owner, projectId: project.id });
    const res = await app.request(`/projects/${project.shortId}/issues/${issue.id}/comments`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(res.status).toBe(404);
  });
});
