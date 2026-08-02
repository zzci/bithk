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

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-hr-routes-${Date.now()}-${nanoid()}`);
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

describe("/hr/colleagues module gating", () => {
  test("a user without the hr module is concealed-404 on every route", async () => {
    const app = buildApp(db);
    // No global role assigned and no default role seeded → fail-closed to
    // no modules, exactly like a default Member role (which excludes hr).
    const plain = await sessionForRole("user");

    const list = await app.request("/hr/colleagues", { headers: { Cookie: plain.cookie } });
    expect(list.status).toBe(404);

    const create = await app.request("/hr/colleagues", jsonReq("POST", plain.cookie, { userId: "x" }));
    expect(create.status).toBe(404);

    const patch = await app.request("/hr/colleagues/x", jsonReq("PATCH", plain.cookie, { title: "T" }));
    expect(patch.status).toBe(404);

    const del = await app.request("/hr/colleagues/x", jsonReq("DELETE", plain.cookie));
    expect(del.status).toBe(404);
  });

  test("a user whose role grants hr can list colleagues (200)", async () => {
    const app = buildApp(db);
    const member = await sessionForRole("user");
    const group = await createGroup(db, { name: "HR", modules: ["hr"] });
    await addGroupMember(db, group.id, member.id);

    const res = await app.request("/hr/colleagues", { headers: { Cookie: member.cookie } });
    expect(res.status).toBe(200);
  });

  test("an unauthenticated request is rejected (401)", async () => {
    const app = buildApp(db);
    const res = await app.request("/hr/colleagues");
    expect(res.status).toBe(401);
  });
});

describe("POST /hr/colleagues", () => {
  test("admin links a real user and gets joined user data back (201)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, {
      userId,
      code: "FC-001",
      title: "Accountant",
      department: "Finance",
      notes: "First hire",
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { userId: string; code: string; status: string; user: { name: string; username: string; isVirtual: boolean; status: string } } };
    expect(body.data.userId).toBe(userId);
    expect(body.data.code).toBe("FC-001");
    expect(body.data.status).toBe("active");
    expect(body.data.user.username).toBe(`user-${userId}`);
    expect(body.data.user.name).toBe(`User ${userId}`);
    expect(body.data.user.isVirtual).toBe(false);
    expect(body.data.user.status).toBe("active");
  });

  test("admin links a virtual user (201) with isVirtual in the joined data", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser({ isVirtual: true });

    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { user: { isVirtual: boolean } } };
    expect(body.data.user.isVirtual).toBe(true);
  });

  test("a missing user is a clean 404", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: "nope" }));
    expect(res.status).toBe(404);
  });

  test("an inactive user is a clean 400", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser({ status: "disabled" });
    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    expect(res.status).toBe(400);
  });

  test("linking the same user twice is a clean 409", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const first = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    expect(first.status).toBe(201);

    const dup = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    expect(dup.status).toBe(409);
  });

  test("a body without userId is rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { title: "T" }));
    expect(res.status).toBe(422);
  });
});

describe("GET /hr/colleagues", () => {
  test("lists colleagues with joined user data and supports the status filter", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const realId = await insertUser();
    const virtualId = await insertUser({ isVirtual: true });

    await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: realId }));
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: virtualId }));
    const createdBody = await created.json() as { data: { id: string } };

    const all = await app.request("/hr/colleagues", { headers: { Cookie: admin.cookie } });
    expect(all.status).toBe(200);
    const allBody = await all.json() as { data: Array<{ userId: string; user: { isVirtual: boolean } }>; meta: { total: number } };
    expect(allBody.meta.total).toBe(2);
    expect(allBody.data.some(c => c.userId === virtualId && c.user.isVirtual)).toBe(true);

    // Archive the virtual colleague, then filter by status.
    await app.request(`/hr/colleagues/${createdBody.data.id}`, jsonReq("DELETE", admin.cookie));

    const active = await app.request("/hr/colleagues?status=active", { headers: { Cookie: admin.cookie } });
    const activeBody = await active.json() as { data: Array<{ userId: string }>; meta: { total: number } };
    expect(activeBody.meta.total).toBe(1);
    expect(activeBody.data[0]!.userId).toBe(realId);

    const archived = await app.request("/hr/colleagues?status=archived", { headers: { Cookie: admin.cookie } });
    const archivedBody = await archived.json() as { data: Array<{ userId: string }>; meta: { total: number } };
    expect(archivedBody.meta.total).toBe(1);
    expect(archivedBody.data[0]!.userId).toBe(virtualId);
  });

  test("q searches user name/username and colleague code", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();
    await insertUser(); // unlinked noise
    const otherId = await insertUser();

    await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, code: "ZZTOP" }));
    await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: otherId }));

    const byCode = await app.request("/hr/colleagues?q=ZZTOP", { headers: { Cookie: admin.cookie } });
    const byCodeBody = await byCode.json() as { meta: { total: number }; data: Array<{ userId: string }> };
    expect(byCodeBody.meta.total).toBe(1);
    expect(byCodeBody.data[0]!.userId).toBe(userId);

    const byName = await app.request(`/hr/colleagues?q=user-${otherId}`, { headers: { Cookie: admin.cookie } });
    const byNameBody = await byName.json() as { meta: { total: number }; data: Array<{ userId: string }> };
    expect(byNameBody.meta.total).toBe(1);
    expect(byNameBody.data[0]!.userId).toBe(otherId);
  });
});

describe("GET /hr/colleagues profile filters", () => {
  // Creates a colleague for a fresh user with the given profile fields and
  // returns the linked userId so assertions can identify the row.
  async function createProfiled(app: Hono<AppEnv>, cookie: string, profile: Record<string, unknown>): Promise<string> {
    const userId = await insertUser();
    const res = await app.request("/hr/colleagues", jsonReq("POST", cookie, { userId, ...profile }));
    expect(res.status).toBe(201);
    return userId;
  }

  async function listUserIds(app: Hono<AppEnv>, cookie: string, query: string): Promise<string[]> {
    const res = await app.request(`/hr/colleagues?${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ userId: string }> };
    return body.data.map(c => c.userId);
  }

  test("employmentType, department and workLocation each narrow the list", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const intern = await createProfiled(app, admin.cookie, { employmentType: "intern", department: "Finance", workLocation: "Oslo" });
    const fullTimer = await createProfiled(app, admin.cookie, { employmentType: "full_time", department: "Engineering", workLocation: "Bergen" });

    expect(await listUserIds(app, admin.cookie, "employmentType=intern")).toEqual([intern]);
    expect(await listUserIds(app, admin.cookie, "department=Engineering")).toEqual([fullTimer]);
    expect(await listUserIds(app, admin.cookie, "workLocation=Oslo")).toEqual([intern]);
  });

  test("hireDateFrom/hireDateTo bound the range and drop rows without a hire date", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const early = await createProfiled(app, admin.cookie, { hireDate: "2023-03-01" });
    const late = await createProfiled(app, admin.cookie, { hireDate: "2025-06-15" });
    await createProfiled(app, admin.cookie, {}); // no hire date
    await createProfiled(app, admin.cookie, { hireDate: "" }); // cleared by the edit form

    expect(await listUserIds(app, admin.cookie, "hireDateFrom=2024-01-01")).toEqual([late]);
    expect(await listUserIds(app, admin.cookie, "hireDateTo=2024-01-01")).toEqual([early]);
    expect(await listUserIds(app, admin.cookie, "hireDateFrom=2023-01-01&hireDateTo=2023-12-31")).toEqual([early]);
  });

  test("filters AND together with each other and with q", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const match = await createProfiled(app, admin.cookie, { employmentType: "full_time", department: "Finance", hireDate: "2024-05-01" });
    await createProfiled(app, admin.cookie, { employmentType: "full_time", department: "Engineering", hireDate: "2024-05-01" });
    await createProfiled(app, admin.cookie, { employmentType: "intern", department: "Finance", hireDate: "2022-01-01" });

    expect(await listUserIds(app, admin.cookie, "employmentType=full_time&department=Finance")).toEqual([match]);
    expect(await listUserIds(app, admin.cookie, "department=Finance&hireDateFrom=2024-01-01")).toEqual([match]);
    expect(await listUserIds(app, admin.cookie, `q=user-${match}&employmentType=intern`)).toEqual([]);
  });

  test("an invalid employmentType or malformed date is rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");

    const badEnum = await app.request("/hr/colleagues?employmentType=freelance", { headers: { Cookie: admin.cookie } });
    expect(badEnum.status).toBe(422);

    const badFrom = await app.request("/hr/colleagues?hireDateFrom=2024/01/01", { headers: { Cookie: admin.cookie } });
    expect(badFrom.status).toBe(422);

    const badTo = await app.request("/hr/colleagues?hireDateTo=notadate", { headers: { Cookie: admin.cookie } });
    expect(badTo.status).toBe(422);

    const emptyFrom = await app.request("/hr/colleagues?hireDateFrom=", { headers: { Cookie: admin.cookie } });
    expect(emptyFrom.status).toBe(422);
  });
});

describe("GET /hr/colleagues/facets", () => {
  test("dedupes values, drops empty strings and sorts ascending", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const profiles = [
      { department: "Finance", workLocation: "Oslo" },
      { department: "Finance", workLocation: "" },
      { department: "Engineering", workLocation: "Bergen" },
      { department: "", workLocation: "Bergen" },
      {}, // NULL department and workLocation
    ];
    for (const profile of profiles) {
      const userId = await insertUser();
      const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, ...profile }));
      expect(res.status).toBe(201);
    }

    const res = await app.request("/hr/colleagues/facets", { headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { departments: string[]; workLocations: string[] } };
    expect(body.data.departments).toEqual(["Engineering", "Finance"]);
    expect(body.data.workLocations).toEqual(["Bergen", "Oslo"]);
  });

  test("is gated like the rest of the module (404 without hr, 401 unauthenticated)", async () => {
    const app = buildApp(db);
    const plain = await sessionForRole("user");

    const gated = await app.request("/hr/colleagues/facets", { headers: { Cookie: plain.cookie } });
    expect(gated.status).toBe(404);

    const anon = await app.request("/hr/colleagues/facets");
    expect(anon.status).toBe(401);
  });
});

describe("PATCH /hr/colleagues/:id", () => {
  test("updates display metadata and status (200)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    const cbody = await created.json() as { data: { id: string } };

    const res = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("PATCH", admin.cookie, {
      title: "Controller",
      department: "Treasury",
      status: "archived",
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { title: string; department: string; status: string } };
    expect(body.data.title).toBe("Controller");
    expect(body.data.department).toBe("Treasury");
    expect(body.data.status).toBe("archived");
  });

  test("relinking to an already-linked user is a 409; to a missing user a 404", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userA = await insertUser();
    const userB = await insertUser();

    const a = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: userA }));
    const abody = await a.json() as { data: { id: string } };
    await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId: userB }));

    const conflict = await app.request(`/hr/colleagues/${abody.data.id}`, jsonReq("PATCH", admin.cookie, { userId: userB }));
    expect(conflict.status).toBe(409);

    const missing = await app.request(`/hr/colleagues/${abody.data.id}`, jsonReq("PATCH", admin.cookie, { userId: "nope" }));
    expect(missing.status).toBe(404);
  });

  test("an unknown colleague id is a 404; an empty body a 422", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");

    const notFound = await app.request("/hr/colleagues/nope", jsonReq("PATCH", admin.cookie, { title: "T" }));
    expect(notFound.status).toBe(404);

    const userId = await insertUser();
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    const cbody = await created.json() as { data: { id: string } };
    const empty = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("PATCH", admin.cookie, {}));
    expect(empty.status).toBe(422);
  });
});

describe("DELETE /hr/colleagues/:id", () => {
  test("archives instead of deleting and is idempotent (200)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    const cbody = await created.json() as { data: { id: string } };

    const res = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("DELETE", admin.cookie));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string } };
    expect(body.data.status).toBe("archived");

    // Still listed (soft archive), and a second archive is a no-op success.
    const list = await app.request("/hr/colleagues", { headers: { Cookie: admin.cookie } });
    const listBody = await list.json() as { meta: { total: number } };
    expect(listBody.meta.total).toBe(1);

    const again = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("DELETE", admin.cookie));
    expect(again.status).toBe(200);
  });

  test("an unknown colleague id is a 404", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const res = await app.request("/hr/colleagues/nope", jsonReq("DELETE", admin.cookie));
    expect(res.status).toBe(404);
  });
});

describe("colleague profile fields", () => {
  test("create persists profile metadata and parses the JSON columns back", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, {
      userId,
      birthday: "1990-05-01",
      hireDate: "2024-01-15",
      gender: "female",
      employmentType: "full_time",
      nationality: "Norwegian",
      personalPhone: "+47 123",
      paymentInfo: [{ label: "Bank", value: "DNB" }, { label: "IBAN", value: "NO123" }],
      emergencyContacts: [{ name: "Bob", relation: "Spouse", phone: "999", email: "", address: "" }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as {
      data: {
        birthday: string;
        gender: string;
        employmentType: string;
        paymentInfo: Array<{ label: string; value: string }>;
        emergencyContacts: Array<{ name: string; relation: string; phone: string; email: string; address: string }>;
      };
    };
    expect(body.data.birthday).toBe("1990-05-01");
    expect(body.data.gender).toBe("female");
    expect(body.data.employmentType).toBe("full_time");
    expect(body.data.paymentInfo).toEqual([{ label: "Bank", value: "DNB" }, { label: "IBAN", value: "NO123" }]);
    expect(body.data.emergencyContacts).toEqual([{ name: "Bob", relation: "Spouse", phone: "999", email: "", address: "" }]);
  });

  test("update replaces the JSON columns and clears a nullable enum", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, {
      userId,
      gender: "male",
      paymentInfo: [{ label: "Old", value: "X" }],
    }));
    const cbody = await created.json() as { data: { id: string } };

    const res = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("PATCH", admin.cookie, {
      gender: null,
      paymentInfo: [{ label: "New", value: "Y" }],
      emergencyContacts: [],
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { gender: string | null; paymentInfo: Array<{ label: string; value: string }>; emergencyContacts: unknown[] };
    };
    expect(body.data.gender).toBeNull();
    expect(body.data.paymentInfo).toEqual([{ label: "New", value: "Y" }]);
    expect(body.data.emergencyContacts).toEqual([]);
  });

  test("an invalid date or enum value is rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const badDate = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, birthday: "1990/05/01" }));
    expect(badDate.status).toBe(422);

    const badEnum = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, gender: "unknown" }));
    expect(badEnum.status).toBe(422);
  });
});

describe("colleague salary fields", () => {
  test("create persists salaryAmount and salaryCurrency and returns both (201)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, {
      userId,
      salaryAmount: 5000_00,
      salaryCurrency: "USD",
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { salaryAmount: number | null; salaryCurrency: string | null } };
    expect(body.data.salaryAmount).toBe(5000_00);
    expect(body.data.salaryCurrency).toBe("USD");
  });

  test("a colleague created without salary fields returns nulls", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const res = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { salaryAmount: number | null; salaryCurrency: string | null } };
    expect(body.data.salaryAmount).toBeNull();
    expect(body.data.salaryCurrency).toBeNull();
  });

  test("update sets salaryAmount and salaryCurrency (200)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();
    const created = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId }));
    const cbody = await created.json() as { data: { id: string } };

    const res = await app.request(`/hr/colleagues/${cbody.data.id}`, jsonReq("PATCH", admin.cookie, {
      salaryAmount: 3200_50,
      salaryCurrency: "EUR",
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { salaryAmount: number | null; salaryCurrency: string | null } };
    expect(body.data.salaryAmount).toBe(3200_50);
    expect(body.data.salaryCurrency).toBe("EUR");
  });

  test("a malformed salaryCurrency is rejected (422)", async () => {
    const app = buildApp(db);
    const admin = await sessionForRole("admin");
    const userId = await insertUser();

    const badCurrency = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, salaryCurrency: "usd" }));
    expect(badCurrency.status).toBe(422);

    const negative = await app.request("/hr/colleagues", jsonReq("POST", admin.cookie, { userId, salaryAmount: -1 }));
    expect(negative.status).toBe(422);
  });
});
