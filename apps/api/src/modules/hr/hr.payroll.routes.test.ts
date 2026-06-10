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
import { moduleGate } from "@/modules/account/roles/middleware";
import { createGlobalRole } from "@/modules/account/roles/roles.service";
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

interface PayrollView {
  id: string;
  colleagueId: string;
  period: string;
  baseSalary: number;
  bonus: number;
  deduction: number;
  currency: string;
  netAmount: number;
  status: string;
  paidAt: string | null;
  colleague: { name: string; username: string; isVirtual: boolean };
}

async function createRecord(
  app: Hono<AppEnv>,
  cookie: string,
  colleagueId: string,
  overrides: Record<string, unknown> = {},
): Promise<PayrollView> {
  const res = await app.request("/hr/payroll", jsonReq("POST", cookie, {
    colleagueId,
    period: "2026-06",
    baseSalary: 100000,
    currency: "CNY",
    ...overrides,
  }));
  expect(res.status).toBe(201);
  const body = await res.json() as { data: PayrollView };
  return body.data;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-hr-payroll-routes-${Date.now()}-${nanoid()}`);
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

describe("/hr/payroll module gating", () => {
  test("a user without the hr module is concealed-404 on every route", async () => {
    const app = buildApp(db);
    // No global role assigned and no default role seeded → fail-closed to
    // no modules, exactly like a default Member role (which excludes hr).
    const plain = await sessionForRole("user");

    const list = await app.request("/hr/payroll", { headers: { Cookie: plain.cookie } });
    expect(list.status).toBe(404);

    const create = await app.request("/hr/payroll", jsonReq("POST", plain.cookie, { colleagueId: "x", period: "2026-06", baseSalary: 1, currency: "CNY" }));
    expect(create.status).toBe(404);

    const patch = await app.request("/hr/payroll/x", jsonReq("PATCH", plain.cookie, { bonus: 1 }));
    expect(patch.status).toBe(404);

    const del = await app.request("/hr/payroll/x", jsonReq("DELETE", plain.cookie));
    expect(del.status).toBe(404);
  });

  test("a user whose role grants hr can list payroll records (200)", async () => {
    const app = buildApp(db);
    const member = await sessionForRole("user");
    const role = await createGlobalRole(db, { name: "HR", modules: ["hr"] });
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, member.id)).run();

    const res = await app.request("/hr/payroll", { headers: { Cookie: member.cookie } });
    expect(res.status).toBe(200);
  });
});

describe("POST /hr/payroll", () => {
  test("admin creates a record (201) with a computed net amount", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const data = await createRecord(app, admin.cookie, colleagueId, {
      baseSalary: 100000,
      bonus: 5000,
      deduction: 2000,
      currency: "USD",
      notes: "June payroll",
    });
    expect(data.period).toBe("2026-06");
    expect(data.baseSalary).toBe(100000);
    expect(data.bonus).toBe(5000);
    expect(data.deduction).toBe(2000);
    expect(data.netAmount).toBe(103000);
    expect(data.currency).toBe("USD");
    expect(data.status).toBe("pending");
    expect(data.paidAt).toBeNull();
    expect(data.colleague.isVirtual).toBe(true);
  });

  test("bonus and deduction default to 0", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const data = await createRecord(app, admin.cookie, colleagueId);
    expect(data.bonus).toBe(0);
    expect(data.deduction).toBe(0);
    expect(data.netAmount).toBe(100000);
  });

  test("a second record for the same colleague and period is a 409; another colleague is fine", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const c1 = await insertColleague();
    const c2 = await insertColleague();

    await createRecord(app, admin.cookie, c1);

    const dup = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId: c1, period: "2026-06", baseSalary: 1, currency: "CNY" }));
    expect(dup.status).toBe(409);

    const other = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId: c2, period: "2026-06", baseSalary: 1, currency: "CNY" }));
    expect(other.status).toBe(201);
  });

  test("invalid period, lowercase currency, or negative amounts are rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const badMonth = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId, period: "2026-13", baseSalary: 1, currency: "CNY" }));
    expect(badMonth.status).toBe(422);

    const badCurrency = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId, period: "2026-06", baseSalary: 1, currency: "cny" }));
    expect(badCurrency.status).toBe(422);

    const negative = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId, period: "2026-06", baseSalary: -1, currency: "CNY" }));
    expect(negative.status).toBe(422);
  });

  test("a deduction beyond base + bonus is a clean 400", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const res = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId, period: "2026-06", baseSalary: 100, deduction: 200, currency: "CNY" }));
    expect(res.status).toBe(400);
  });

  test("a missing colleague is a 404; an archived one a 400", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");

    const missing = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId: "nope", period: "2026-06", baseSalary: 1, currency: "CNY" }));
    expect(missing.status).toBe(404);

    const archived = await insertColleague({ status: "archived" });
    const res = await app.request("/hr/payroll", jsonReq("POST", admin.cookie, { colleagueId: archived, period: "2026-06", baseSalary: 1, currency: "CNY" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /hr/payroll", () => {
  test("filters by period, status, and colleague", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const c1 = await insertColleague();
    const c2 = await insertColleague();

    const may = await createRecord(app, admin.cookie, c1, { period: "2026-05" });
    await createRecord(app, admin.cookie, c1, { period: "2026-06" });
    await createRecord(app, admin.cookie, c2, { period: "2026-06", currency: "HKD" });

    const paid = await app.request(`/hr/payroll/${may.id}`, jsonReq("PATCH", admin.cookie, { status: "paid" }));
    expect(paid.status).toBe(200);

    const byPeriod = await app.request("/hr/payroll?period=2026-06", { headers: { Cookie: admin.cookie } });
    const byPeriodBody = await byPeriod.json() as { meta: { total: number } };
    expect(byPeriodBody.meta.total).toBe(2);

    const pending = await app.request("/hr/payroll?status=pending", { headers: { Cookie: admin.cookie } });
    const pendingBody = await pending.json() as { meta: { total: number } };
    expect(pendingBody.meta.total).toBe(2);

    const byColleague = await app.request(`/hr/payroll?colleagueId=${c1}`, { headers: { Cookie: admin.cookie } });
    const byColleagueBody = await byColleague.json() as { data: PayrollView[]; meta: { total: number } };
    expect(byColleagueBody.meta.total).toBe(2);
    // Newest period first.
    expect(byColleagueBody.data[0]?.period).toBe("2026-06");
  });
});

describe("PATCH /hr/payroll/:id", () => {
  test("amount changes recompute the net; period moves revalidate uniqueness", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const record = await createRecord(app, admin.cookie, colleagueId, { bonus: 1000 });
    await createRecord(app, admin.cookie, colleagueId, { period: "2026-07" });

    const res = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { deduction: 500, currency: "EUR" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: PayrollView };
    expect(body.data.netAmount).toBe(100500);
    expect(body.data.currency).toBe("EUR");

    const collide = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { period: "2026-07" }));
    expect(collide.status).toBe(409);

    const negative = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { deduction: 999999 }));
    expect(negative.status).toBe(400);

    const unknown = await app.request("/hr/payroll/nope", jsonReq("PATCH", admin.cookie, { bonus: 1 }));
    expect(unknown.status).toBe(404);
  });

  test("marking paid stamps paidAt; paid records are immutable", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();
    const record = await createRecord(app, admin.cookie, colleagueId);

    const pay = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { status: "paid" }));
    expect(pay.status).toBe(200);
    const paid = await pay.json() as { data: PayrollView };
    expect(paid.data.status).toBe("paid");
    expect(paid.data.paidAt).not.toBeNull();

    const again = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { bonus: 1 }));
    expect(again.status).toBe(409);

    const revert = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { status: "pending" }));
    expect(revert.status).toBe(422);
  });
});

describe("DELETE /hr/payroll/:id", () => {
  test("a pending record can be deleted; a paid one cannot (409)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const colleagueId = await insertColleague();

    const pending = await createRecord(app, admin.cookie, colleagueId);
    const del = await app.request(`/hr/payroll/${pending.id}`, jsonReq("DELETE", admin.cookie));
    expect(del.status).toBe(200);

    const gone = await app.request(`/hr/payroll/${pending.id}`, jsonReq("DELETE", admin.cookie));
    expect(gone.status).toBe(404);

    const record = await createRecord(app, admin.cookie, colleagueId, { period: "2026-07" });
    const pay = await app.request(`/hr/payroll/${record.id}`, jsonReq("PATCH", admin.cookie, { status: "paid" }));
    expect(pay.status).toBe(200);

    const res = await app.request(`/hr/payroll/${record.id}`, jsonReq("DELETE", admin.cookie));
    expect(res.status).toBe(409);
  });
});
