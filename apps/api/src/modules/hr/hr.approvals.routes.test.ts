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
import { addGroupMember, createGroup } from "@/modules/account/groups/groups.service";
import { moduleGate } from "@/modules/account/groups/module-gate";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { hrRoutes } from "./hr.routes";
import { hrColleagues } from "./schema";
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
  // Mirror the protected router: the module gate owns hr access (PLAN-076).
  app.use("*", moduleGate());
  app.route("/", hrRoutes());
  app.onError(errorHandler);
  return app;
}

let db: AppDatabase;
let dbPath: string;

interface UserRowOptions {
  role?: "admin" | "user";
  status?: "active" | "disabled";
  isVirtual?: boolean;
}

async function insertUser(opts: UserRowOptions = {}): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: opts.isVirtual ? `virtual:${id}` : `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: opts.role ?? "user",
    status: opts.status ?? "active",
    isVirtual: opts.isVirtual ?? false,
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

async function insertColleague(opts: { status?: "active" | "archived" } = {}): Promise<string> {
  const userId = await insertUser({ isVirtual: true });
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(hrColleagues).values({
    id,
    userId,
    status: opts.status ?? "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

async function sessionForRole(role: "admin" | "user"): Promise<{ id: string; cookie: string }> {
  const id = await insertUser({ role });
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

interface ApprovalView {
  id: string;
  colleagueId: string;
  type: string;
  title: string;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  applicant: { name: string; username: string; isVirtual: boolean };
}

async function createApprovalReq(
  app: Hono<AppEnv>,
  cookie: string,
  colleagueId: string,
  overrides: Record<string, unknown> = {},
): Promise<ApprovalView> {
  const res = await app.request("/hr/approvals", jsonReq("POST", cookie, {
    colleagueId,
    type: "leave",
    title: "Annual leave",
    ...overrides,
  }));
  expect(res.status).toBe(201);
  const body = await res.json() as { data: ApprovalView };
  return body.data;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-hr-approval-routes-${Date.now()}-${nanoid()}`);
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

describe("/hr/approvals module gating", () => {
  test("a user without the hr module is concealed-404 on every route", async () => {
    const app = buildApp(db);
    // No global role assigned and no default role seeded → fail-closed to
    // no modules, exactly like a default Member role (which excludes hr).
    const plain = await sessionForRole("user");

    const list = await app.request("/hr/approvals", { headers: { Cookie: plain.cookie } });
    expect(list.status).toBe(404);

    const create = await app.request("/hr/approvals", jsonReq("POST", plain.cookie, { colleagueId: "x", type: "leave", title: "T" }));
    expect(create.status).toBe(404);

    const patch = await app.request("/hr/approvals/x", jsonReq("PATCH", plain.cookie, { title: "T" }));
    expect(patch.status).toBe(404);

    const decide = await app.request("/hr/approvals/x/decision", jsonReq("POST", plain.cookie, { status: "approved" }));
    expect(decide.status).toBe(404);

    const del = await app.request("/hr/approvals/x", jsonReq("DELETE", plain.cookie));
    expect(del.status).toBe(404);
  });

  test("a user whose role grants hr can list approvals (200)", async () => {
    const app = buildApp(db);
    const member = await sessionForRole("user");
    const group = await createGroup(db, { name: "HR", modules: ["hr"] });
    await addGroupMember(db, group.id, member.id);

    const res = await app.request("/hr/approvals", { headers: { Cookie: member.cookie } });
    expect(res.status).toBe(200);
  });
});

describe("POST /hr/approvals", () => {
  test("admin files a request (201) with joined applicant data", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const data = await createApprovalReq(app, admin.cookie, colleagueId, {
      type: "business_trip",
      title: "Shipyard visit",
      reason: "Inspection",
    });
    expect(data.colleagueId).toBe(colleagueId);
    expect(data.type).toBe("business_trip");
    expect(data.title).toBe("Shipyard visit");
    expect(data.reason).toBe("Inspection");
    expect(data.status).toBe("pending");
    expect(data.decidedByName).toBeNull();
    expect(data.decidedAt).toBeNull();
    expect(data.applicant.isVirtual).toBe(true);
    expect(data.applicant.name.startsWith("User ")).toBe(true);
  });

  test("a missing colleague is a clean 404; an archived one a 400", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");

    const missing = await app.request("/hr/approvals", jsonReq("POST", admin.cookie, { colleagueId: "nope", type: "leave", title: "T" }));
    expect(missing.status).toBe(404);

    const archived = await insertColleague({ status: "archived" });
    const res = await app.request("/hr/approvals", jsonReq("POST", admin.cookie, { colleagueId: archived, type: "leave", title: "T" }));
    expect(res.status).toBe(400);
  });

  test("an unknown type or empty title is rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const badType = await app.request("/hr/approvals", jsonReq("POST", admin.cookie, { colleagueId, type: "vacation", title: "T" }));
    expect(badType.status).toBe(422);

    const noTitle = await app.request("/hr/approvals", jsonReq("POST", admin.cookie, { colleagueId, type: "leave", title: "" }));
    expect(noTitle.status).toBe(422);
  });
});

describe("GET /hr/approvals", () => {
  test("filters by status, type, and q", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const c1 = await insertColleague();
    const c2 = await insertColleague();

    const leave = await createApprovalReq(app, admin.cookie, c1, { title: "Annual leave" });
    await createApprovalReq(app, admin.cookie, c2, { type: "overtime", title: "Weekend overtime" });

    const approve = await app.request(`/hr/approvals/${leave.id}/decision`, jsonReq("POST", admin.cookie, { status: "approved" }));
    expect(approve.status).toBe(200);

    const pending = await app.request("/hr/approvals?status=pending", { headers: { Cookie: admin.cookie } });
    const pendingBody = await pending.json() as { data: ApprovalView[]; meta: { total: number } };
    expect(pendingBody.meta.total).toBe(1);
    expect(pendingBody.data[0]?.type).toBe("overtime");

    const byType = await app.request("/hr/approvals?type=leave", { headers: { Cookie: admin.cookie } });
    const byTypeBody = await byType.json() as { data: ApprovalView[]; meta: { total: number } };
    expect(byTypeBody.meta.total).toBe(1);
    expect(byTypeBody.data[0]?.id).toBe(leave.id);

    const byTitle = await app.request("/hr/approvals?q=Weekend", { headers: { Cookie: admin.cookie } });
    const byTitleBody = await byTitle.json() as { meta: { total: number } };
    expect(byTitleBody.meta.total).toBe(1);
  });
});

describe("PATCH /hr/approvals/:id", () => {
  test("a pending request is editable; an empty body is a 422; unknown id a 404", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();
    const approval = await createApprovalReq(app, admin.cookie, colleagueId);

    const res = await app.request(`/hr/approvals/${approval.id}`, jsonReq("PATCH", admin.cookie, { title: "Sick leave", type: "other" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: ApprovalView };
    expect(body.data.title).toBe("Sick leave");
    expect(body.data.type).toBe("other");

    const empty = await app.request(`/hr/approvals/${approval.id}`, jsonReq("PATCH", admin.cookie, {}));
    expect(empty.status).toBe(422);

    const unknown = await app.request("/hr/approvals/nope", jsonReq("PATCH", admin.cookie, { title: "T" }));
    expect(unknown.status).toBe(404);
  });

  test("a decided request is immutable (409)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();
    const approval = await createApprovalReq(app, admin.cookie, colleagueId);

    const decide = await app.request(`/hr/approvals/${approval.id}/decision`, jsonReq("POST", admin.cookie, { status: "rejected" }));
    expect(decide.status).toBe(200);

    const patch = await app.request(`/hr/approvals/${approval.id}`, jsonReq("PATCH", admin.cookie, { title: "T" }));
    expect(patch.status).toBe(409);
  });
});

describe("POST /hr/approvals/:id/decision", () => {
  test("approving stamps the decider, time, and note", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();
    const approval = await createApprovalReq(app, admin.cookie, colleagueId);

    const res = await app.request(`/hr/approvals/${approval.id}/decision`, jsonReq("POST", admin.cookie, { status: "approved", note: "OK" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: ApprovalView };
    expect(body.data.status).toBe("approved");
    expect(body.data.decisionNote).toBe("OK");
    expect(body.data.decidedAt).not.toBeNull();
    expect(body.data.decidedByName).toBe(`User ${admin.id}`);
  });

  test("deciding twice is a 409; an invalid status a 422; unknown id a 404", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();
    const approval = await createApprovalReq(app, admin.cookie, colleagueId);

    const first = await app.request(`/hr/approvals/${approval.id}/decision`, jsonReq("POST", admin.cookie, { status: "rejected" }));
    expect(first.status).toBe(200);

    const again = await app.request(`/hr/approvals/${approval.id}/decision`, jsonReq("POST", admin.cookie, { status: "approved" }));
    expect(again.status).toBe(409);

    const invalid = await app.request(`/hr/approvals/${approval.id}/decision`, jsonReq("POST", admin.cookie, { status: "pending" }));
    expect(invalid.status).toBe(422);

    const unknown = await app.request("/hr/approvals/nope/decision", jsonReq("POST", admin.cookie, { status: "approved" }));
    expect(unknown.status).toBe(404);
  });
});

describe("DELETE /hr/approvals/:id", () => {
  test("a pending request can be withdrawn; a decided one cannot (409)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const pending = await createApprovalReq(app, admin.cookie, colleagueId);
    const del = await app.request(`/hr/approvals/${pending.id}`, jsonReq("DELETE", admin.cookie));
    expect(del.status).toBe(200);

    const gone = await app.request(`/hr/approvals/${pending.id}`, jsonReq("DELETE", admin.cookie));
    expect(gone.status).toBe(404);

    const decided = await createApprovalReq(app, admin.cookie, colleagueId);
    const decide = await app.request(`/hr/approvals/${decided.id}/decision`, jsonReq("POST", admin.cookie, { status: "approved" }));
    expect(decide.status).toBe(200);

    const res = await app.request(`/hr/approvals/${decided.id}`, jsonReq("DELETE", admin.cookie));
    expect(res.status).toBe(409);
  });
});
