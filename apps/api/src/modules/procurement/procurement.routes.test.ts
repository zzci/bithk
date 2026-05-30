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
import { auditEvents } from "@/modules/audit/schema";
import * as contactService from "@/modules/contact/contact.service";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createRole, listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { errorHandler } from "@/shared/middleware/error-handler";
import { procurementRoutes } from "./procurement.routes";
import { createProcurement } from "./procurement.service";
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
  app.route("/", procurementRoutes());
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

async function seedGlobalContact(ownerId: string, name = "Supplier Co") {
  return await contactService.create(db, { id: ownerId, role: "user" }, { name });
}

async function cookieForUser(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

/** Add a user as a member holding a custom role with the given capabilities. */
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
  const dir = resolve(tmpdir(), `test-procurement-routes-${Date.now()}-${nanoid()}`);
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

describe("visibility gating (procurement.view)", () => {
  test("GET → 401 without a session", async () => {
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await buildApp(db).request(`/projects/${project.shortId}/procurements`);
    expect(res.status).toBe(401);
  });

  test("the pm (all caps) lists; a Guest member without procurement.view is fail-closed 404", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const plain = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    // Use the Guest role (no capabilities) to test fail-closed behavior.
    const guestRole = (await listRoles(db, project.id)).find(r => r.kind === "guest")!;
    await addMember(db, project.id, { roleId: guestRole.id, userId: plain });

    const pmRes = await app.request(`/projects/${project.shortId}/procurements`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(pmRes.status).toBe(200);

    const plainRes = await app.request(`/projects/${project.shortId}/procurements`, { headers: { Cookie: await cookieForUser(plain) } });
    expect(plainRes.status).toBe(404);
  });

  test("a non-member is fail-closed 404; an app admin bypasses entirely", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const outsider = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });

    const out = await app.request(`/projects/${project.shortId}/procurements`, { headers: { Cookie: await cookieForUser(outsider) } });
    expect(out.status).toBe(404);

    const adminRes = await app.request(`/projects/${project.shortId}/procurements`, { headers: { Cookie: await cookieForUser(admin) } });
    expect(adminRes.status).toBe(200);
  });
});

describe("POST procurement (procurement.manage)", () => {
  test("a view-only member cannot create (404); the pm can (201)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const viewer = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, viewer, ["procurement.view"]);

    const denied = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", await cookieForUser(viewer), { itemName: "Steel" }));
    expect(denied.status).toBe(404);

    const ok = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", await cookieForUser(owner), { itemName: "Steel", quantity: 10, amount: 500 }));
    expect(ok.status).toBe(201);
    const body = await res2json(ok);
    expect(body.data.itemName).toBe("Steel");
    expect(body.data.status).toBe("requested");
  });

  test("create accepts description/priority/dueDate and defaults priority to medium", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const withFields = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, {
      itemName: "Generators",
      description: "Backup power",
      priority: "high",
      dueDate: "2026-09-01",
    }));
    expect(withFields.status).toBe(201);
    const wf = (await res2json(withFields)).data;
    expect(wf.description).toBe("Backup power");
    expect(wf.priority).toBe("high");
    expect(wf.dueDate).toBe("2026-09-01");

    const defaults = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, { itemName: "Bolts" }));
    expect(defaults.status).toBe(201);
    const df = (await res2json(defaults)).data;
    expect(df.priority).toBe("medium");
    expect(df.description).toBeNull();
    expect(df.dueDate).toBeNull();
  });

  test("an invalid priority is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", await cookieForUser(owner), { itemName: "X", priority: "critical" }));
    expect(res.status).toBe(422);
  });

  test("a negative quantity or amount is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const negQty = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, { itemName: "X", quantity: -1 }));
    expect(negQty.status).toBe(422);

    const negAmt = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, { itemName: "X", amount: -5 }));
    expect(negAmt.status).toBe(422);
  });

  test("an existing global contact is accepted as supplier", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const contactOwner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const supplier = await seedGlobalContact(contactOwner);
    const res = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", await cookieForUser(owner), { itemName: "X", supplierId: supplier.id }));
    expect(res.status).toBe(201);
    expect((await res2json(res)).data.supplierId).toBe(supplier.id);
  });

  test("an unknown supplier contact is rejected (422)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", await cookieForUser(owner), { itemName: "X", supplierId: "missing-supplier" }));
    expect(res.status).toBe(422);
  });
});

describe("detail / update / delete (cross-project + manage gate)", () => {
  test("a procurement from another project 404s on the wrong path", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const other = await createProject(db, { name: "Other", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });

    const wrong = await app.request(`/projects/${other.shortId}/procurements/${proc.id}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(wrong.status).toBe(404);

    const right = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, { headers: { Cookie: await cookieForUser(owner) } });
    expect(right.status).toBe(200);
  });

  test("a view-only member can read but not update or delete (404 on mutate)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const viewer = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, viewer, ["procurement.view"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const cookie = await cookieForUser(viewer);

    expect((await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("PATCH", cookie, { itemName: "Y" }))).status).toBe(404);
    expect((await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("DELETE", cookie))).status).toBe(404);
  });

  test("the pm updates; deletion is unavailable (no DELETE route)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const patched = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("PATCH", cookie, { itemName: "Steel pipes", quantity: 5 }));
    expect(patched.status).toBe(200);
    expect((await res2json(patched)).data.itemName).toBe("Steel pipes");

    // Issue-parity fields update, and null clears description / dueDate.
    const detail = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("PATCH", cookie, {
      description: "A note",
      priority: "urgent",
      dueDate: "2026-10-10",
    }));
    expect(detail.status).toBe(200);
    const dd = (await res2json(detail)).data;
    expect(dd.description).toBe("A note");
    expect(dd.priority).toBe("urgent");
    expect(dd.dueDate).toBe("2026-10-10");

    const cleared = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("PATCH", cookie, { description: null, dueDate: null }));
    expect(cleared.status).toBe(200);
    const cd = (await res2json(cleared)).data;
    expect(cd.description).toBeNull();
    expect(cd.dueDate).toBeNull();
    expect(cd.priority).toBe("urgent");

    // Procurement is non-deletable: the DELETE route does not exist (404),
    // and the procurement remains addressable afterwards.
    const del = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("DELETE", cookie));
    expect(del.status).toBe(404);

    const stillThere = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, { headers: { Cookie: cookie } });
    expect(stillThere.status).toBe(200);
  });
});

describe("status change", () => {
  test("the pm transitions status and an audit event is written", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const res = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/status`, jsonReq("POST", cookie, { status: "requested" }));
    expect(res.status).toBe(200);
    expect((await res2json(res)).data.status).toBe("requested");

    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "procurement.status_changed")).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.resourceId).toBe(proc.id);
  });

  test("free transitions: the pm moves backward and out of 'accepted', version bumping each time", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const cookie = await cookieForUser(owner);

    let lastVersion = proc.version;
    for (const next of ["accepted", "cancelled", "requested", "received"]) {
      const res = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/status`, jsonReq("POST", cookie, { status: next }));
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; version: number } };
      expect(body.data.status).toBe(next);
      expect(body.data.version).toBeGreaterThan(lastVersion);
      lastVersion = body.data.version;
    }
  });

  test("an unknown status value is rejected with 422", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/status`, jsonReq("POST", await cookieForUser(owner), { status: "bogus" }));
    expect(res.status).toBe(422);
  });

  test("a view-only member cannot change status (404)", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const viewer = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, viewer, ["procurement.view"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const res = await app.request(`/projects/${project.shortId}/procurements/${proc.id}/status`, jsonReq("POST", await cookieForUser(viewer), { status: "requested" }));
    expect(res.status).toBe(404);
  });
});

describe("tags + list filters", () => {
  test("create accepts tags, embeds them, and the list filters by tagIds (OR) + q", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);

    const created = await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, { itemName: "Steel beams", tags: ["alpha", "beta"] }));
    expect(created.status).toBe(201);
    expect((await res2json(created)).data.tags!.map(t => t.name).sort()).toEqual(["alpha", "beta"]);

    await app.request(`/projects/${project.shortId}/procurements`, jsonReq("POST", cookie, { itemName: "Copper wire", tags: ["gamma"] }));

    // tagIds filter (repeated + comma forms both supported), OR / union semantics
    const byTag = await app.request(`/projects/${project.shortId}/procurements?tagIds=alpha,gamma`, { headers: { Cookie: cookie } });
    expect(byTag.status).toBe(200);
    const tagBody = await byTag.json() as { data: { itemName: string }[]; meta: { total: number } };
    expect(tagBody.meta.total).toBe(2);

    const single = await app.request(`/projects/${project.shortId}/procurements?tagIds=gamma`, { headers: { Cookie: cookie } });
    const singleBody = await single.json() as { data: { itemName: string }[] };
    expect(singleBody.data.map(r => r.itemName)).toEqual(["Copper wire"]);

    // q filter on item name
    const byQ = await app.request(`/projects/${project.shortId}/procurements?q=steel`, { headers: { Cookie: cookie } });
    const qBody = await byQ.json() as { data: { itemName: string }[] };
    expect(qBody.data.map(r => r.itemName)).toEqual(["Steel beams"]);
  });

  test("update replaces the tag set", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const cookie = await cookieForUser(owner);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner, tags: ["alpha"] });

    const patched = await app.request(`/projects/${project.shortId}/procurements/${proc.id}`, jsonReq("PATCH", cookie, { tags: ["beta", "gamma"] }));
    expect(patched.status).toBe(200);
    expect((await res2json(patched)).data.tags!.map(t => t.name).sort()).toEqual(["beta", "gamma"]);
  });
});

describe("comments (procurement.view / procurement.comment gate)", () => {
  test("a member with procurement.view can read comments but gets 403 on POST", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const viewer = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, viewer, ["procurement.view"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const base = `/projects/${project.shortId}/procurements/${proc.id}`;
    const viewerCookie = await cookieForUser(viewer);

    // Read is allowed (procurement.view)
    const listed = await app.request(`${base}/comments`, { headers: { Cookie: viewerCookie } });
    expect(listed.status).toBe(200);

    // Post is denied (lacks procurement.comment) → 403
    const posted = await app.request(`${base}/comments`, jsonReq("POST", viewerCookie, { content: "hello" }));
    expect(posted.status).toBe(403);
  });

  test("a member with procurement.comment can post comments", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const commenter = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    await addMemberWithCaps(project.id, commenter, ["procurement.view", "procurement.comment"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const base = `/projects/${project.shortId}/procurements/${proc.id}`;
    const commenterCookie = await cookieForUser(commenter);

    const posted = await app.request(`${base}/comments`, jsonReq("POST", commenterCookie, { content: "looks good" }));
    expect(posted.status).toBe(201);
    const body = await posted.json() as { data: { content: string } };
    expect(body.data.content).toBe("looks good");

    // Can also read
    const listed = await app.request(`${base}/comments`, { headers: { Cookie: commenterCookie } });
    expect(listed.status).toBe(200);
  });

  test("a member with neither procurement.view nor procurement.comment is fail-closed 404 on comments", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const guest = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    // No capabilities at all
    await addMemberWithCaps(project.id, guest, []);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const base = `/projects/${project.shortId}/procurements/${proc.id}`;
    const guestCookie = await cookieForUser(guest);

    const listed = await app.request(`${base}/comments`, { headers: { Cookie: guestCookie } });
    expect(listed.status).toBe(404);

    const posted = await app.request(`${base}/comments`, jsonReq("POST", guestCookie, { content: "hello" }));
    expect(posted.status).toBe(404);
  });

  test("an app admin bypasses all capability checks and can post comments", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "P", creatorId: owner });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: owner });
    const base = `/projects/${project.shortId}/procurements/${proc.id}`;
    const adminCookie = await cookieForUser(admin);

    const posted = await app.request(`${base}/comments`, jsonReq("POST", adminCookie, { content: "admin comment" }));
    expect(posted.status).toBe(201);
  });

  test("Commenter preset (procurement.view + procurement.comment) allows read and post", async () => {
    const app = buildApp(db);
    const owner = await seedUser("user");
    const commenter = await seedUser("user");
    const project = await createProject(db, { name: "P", creatorId: owner });
    // Commenter preset caps
    await addMemberWithCaps(project.id, commenter, ["procurement.view", "procurement.comment"]);
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Widget", creatorId: owner });
    const base = `/projects/${project.shortId}/procurements/${proc.id}`;
    const cookie = await cookieForUser(commenter);

    const listed = await app.request(`${base}/comments`, { headers: { Cookie: cookie } });
    expect(listed.status).toBe(200);

    const posted = await app.request(`${base}/comments`, jsonReq("POST", cookie, { content: "ordered" }));
    expect(posted.status).toBe(201);
  });
});

interface ProcurementResponse {
  data: {
    itemName: string;
    status: string;
    supplierId?: string | null;
    description?: string | null;
    priority?: string;
    dueDate?: string | null;
    tags?: { id: string; name: string }[];
  };
}

async function res2json(res: Response): Promise<ProcurementResponse> {
  return await res.json() as ProcurementResponse;
}
