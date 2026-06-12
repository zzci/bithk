import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { addGroupMember, createGroup } from "@/modules/account/groups/groups.service";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { policyMiddleware } from "@/modules/policy";
import { createTuple } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { protectedRoutes } from "@/routes/protected";
import { errorHandler } from "@/shared/middleware/error-handler";
import { createContactCategory } from "./contact-category.service";
import { contactRoutes } from "./contact.routes";
import { contacts } from "./schema";
import "@/modules/account";

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against the
// magic bytes, so a forged text payload would be rejected.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

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

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-contact-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("contact routes", () => {
  test("GET /contacts returns only visible rows and masks confidential public contacts", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    await createContact(app, owner, { kind: "individual", name: "Private Co", email: "private@example.test" });
    const secret = await createdContact(app, owner, {
      kind: "individual",
      name: "Public Secret",
      email: "secret@example.test",
      phone: "123",
      visibility: "public",
      confidential: true,
      tags: ["supplier"],
    });
    // The sensitivity invariant refuses public+confidential at the service
    // layer; stamp it directly so the masking path is still exercised end-to-end.
    await db.update(contacts).set({ visibility: "public", confidential: true }).where(eq(contacts.id, secret.id)).run();

    const res = await app.request("/contacts", { headers: { "x-uid": viewer } });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: ContactView[] };
    expect(body.data.map(c => c.name)).toEqual(["Public Secret"]);
    expect(body.data[0]!.email).toBeNull();
    expect(body.data[0]!.phone).toBeNull();
    expect(body.data[0]!.status).toBeNull();
    expect(body.data[0]!.tags.map(t => t.name)).toEqual(["supplier"]);
  });

  test("POST /contacts creates an owner-managed contact", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    const res = await createContact(app, owner, { name: "Owner Co", tags: ["supplier", "priority"] });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: ContactView };
    expect(body.data.ownerId).toBe(owner);
    expect(body.data.canManage).toBe(true);
    expect(body.data.tags.map(t => t.name).sort()).toEqual(["priority", "supplier"]);
    const tuple = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "contact"),
      eq(relationTuples.objectId, body.data.id),
      eq(relationTuples.relation, "owner"),
      eq(relationTuples.subjectId, owner),
    )).get();
    expect(tuple).toBeDefined();
  });

  test("private contacts hide read, update, and delete from strangers", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const created = await createdContact(app, owner, { name: "Private Co" });

    const get = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": stranger } });
    expect(get.status).toBe(404);

    const patch = await app.request(`/contacts/${created.id}`, jsonReq(stranger, "PATCH", { name: "Nope" }));
    expect(patch.status).toBe(404);

    const del = await app.request(`/contacts/${created.id}`, { method: "DELETE", headers: { "x-uid": stranger } });
    expect(del.status).toBe(404);

    const ownerPatch = await app.request(`/contacts/${created.id}`, jsonReq(owner, "PATCH", { name: "Renamed" }));
    expect(ownerPatch.status).toBe(200);
    expect(((await ownerPatch.json()) as { data: ContactView }).data.name).toBe("Renamed");

    const ownerDelete = await app.request(`/contacts/${created.id}`, { method: "DELETE", headers: { "x-uid": owner } });
    expect(ownerDelete.status).toBe(200);
  });

  test("public contacts are readable by any authenticated user", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const created = await createdContact(app, owner, {
      kind: "individual",
      name: "Public Co",
      email: "public@example.test",
      visibility: "public",
    });

    const res = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": viewer } });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: ContactView };
    expect(body.data.name).toBe("Public Co");
    expect(body.data.email).toBe("public@example.test");
    expect(body.data.canManage).toBe(false);
  });

  test("confidential public contact masks API fields for implicit readers", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const created = await createdContact(app, owner, {
      kind: "individual",
      name: "Secret Co",
      phone: "123",
      email: "secret@example.test",
      position: "Hidden Role",
      note: "Sensitive",
      status: "inactive",
      visibility: "public",
      confidential: true,
      tags: ["supplier"],
    });
    // The sensitivity invariant refuses public+confidential at the service
    // layer; stamp it directly so the masking path is still exercised end-to-end.
    await db.update(contacts).set({ visibility: "public", confidential: true }).where(eq(contacts.id, created.id)).run();

    const res = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": viewer } });

    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: ContactView }).data;
    expect(data.name).toBe("Secret Co");
    expect(data.kind).toBe("individual");
    expect(data.tags.map(t => t.name)).toEqual(["supplier"]);
    expect(data.phone).toBeNull();
    expect(data.email).toBeNull();
    expect(data.position).toBeNull();
    expect(data.note).toBeNull();
    expect(data.status).toBeNull();
  });

  test("granting and revoking a user controls private contact read access", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const created = await createdContact(app, owner, { kind: "individual", name: "Shared Co", email: "shared@example.test" });

    const grant = await app.request(`/contacts/${created.id}/grant`, jsonReq(owner, "POST", { userId: viewer }));
    expect(grant.status).toBe(200);

    const allowed = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": viewer } });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { data: ContactView }).data.email).toBe("shared@example.test");

    const revoke = await app.request(`/contacts/${created.id}/revoke`, jsonReq(owner, "POST", { userId: viewer }));
    expect(revoke.status).toBe(200);
    expect(((await revoke.json()) as { data: { revoked: boolean } }).data.revoked).toBe(true);

    const denied = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": viewer } });
    expect(denied.status).toBe(404);
  });

  test("granting a group lets group members read private contacts", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const member = await seedUser("member-a");
    const created = await createdContact(app, owner, { name: "Group Co", phone: "456" });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: member,
    }, owner);

    const grant = await app.request(`/contacts/${created.id}/grant`, jsonReq(owner, "POST", { groupId: "group-a" }));
    expect(grant.status).toBe(200);

    const res = await app.request(`/contacts/${created.id}`, { headers: { "x-uid": member } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: ContactView }).data.phone).toBe("456");
  });

  test("GET /contacts filters by a multi-tag union (repeated + comma forms)", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    await createdContact(app, owner, { name: "Supplier Co", tags: ["supplier", "priority"] });
    await createdContact(app, owner, { name: "Client Co", tags: ["client"] });
    await createdContact(app, owner, { name: "Plain Co" });

    const single = await app.request("/contacts?tagIds=supplier", { headers: { "x-uid": owner } });
    expect(single.status).toBe(200);
    expect(((await single.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Supplier Co"]);

    // union via repeated params: a row carrying ANY selected tag matches.
    const repeated = await app.request("/contacts?tagIds=supplier&tagIds=client", { headers: { "x-uid": owner } });
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { data: ContactView[] }).data.map(c => c.name).sort())
      .toEqual(["Client Co", "Supplier Co"]);

    // union via comma-separated form.
    const comma = await app.request("/contacts?tagIds=supplier,client", { headers: { "x-uid": owner } });
    expect(((await comma.json()) as { data: ContactView[] }).data.map(c => c.name).sort())
      .toEqual(["Client Co", "Supplier Co"]);
  });

  test("GET /contacts always returns a meta envelope (full-list mode)", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    await createdContact(app, owner, { name: "A Co" });
    await createdContact(app, owner, { name: "B Co" });

    const res = await app.request("/contacts", { headers: { "x-uid": owner } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: ContactView[]; meta: { total: number; page: number; limit: number } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(2);
  });

  test("GET /contacts paginates when page is provided", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    for (let i = 0; i < 3; i++)
      await createdContact(app, owner, { name: `Co ${i}` });

    const res = await app.request("/contacts?page=1&limit=2", { headers: { "x-uid": owner } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: ContactView[]; meta: { total: number; page: number; limit: number } };
    expect(body.data).toHaveLength(2);
    expect(body.meta).toEqual({ total: 3, page: 1, limit: 2 });
  });

  test("GET /contacts supports q, status, and categoryId filters", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const cat = await createContactCategory(db, { name: "Suppliers" });
    await createdContact(app, owner, { name: "Acme Co", status: "active", categoryId: cat.id });
    await createdContact(app, owner, { name: "Other Co", status: "inactive" });

    const byQ = await app.request("/contacts?q=acme", { headers: { "x-uid": owner } });
    expect(((await byQ.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Acme Co"]);

    const byStatus = await app.request("/contacts?status=inactive", { headers: { "x-uid": owner } });
    expect(((await byStatus.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Other Co"]);

    const byCategory = await app.request(`/contacts?categoryId=${cat.id}`, { headers: { "x-uid": owner } });
    expect(((await byCategory.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Acme Co"]);
  });

  test("GET /contacts?sensitivity=confidential returns only confidential contacts", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    await createdContact(app, owner, { name: "Public Co", visibility: "public", confidential: false });
    await createdContact(app, owner, { name: "Private Co", visibility: "private", confidential: false });
    // confidential=true is coerced to private by the invariant; the owner still
    // sees its own rows, so the sensitivity filter is what narrows the result.
    await createdContact(app, owner, { name: "Confidential Co", confidential: true });

    const res = await app.request("/contacts?sensitivity=confidential", { headers: { "x-uid": owner } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Confidential Co"]);
  });

  test("GET /contacts ignores legacy visibility/confidential query params for filtering", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    await createdContact(app, owner, { name: "Pub Co", visibility: "public" });
    await createdContact(app, owner, { name: "Priv Co", visibility: "private", confidential: true });

    // These params are no longer user-facing filters; the owner still sees both rows.
    const res = await app.request("/contacts?visibility=public&confidential=false", { headers: { "x-uid": owner } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: ContactView[] }).data.map(c => c.name).sort())
      .toEqual(["Priv Co", "Pub Co"]);
  });

  test("POST /contacts creates an individual that links to an inline organization", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    const res = await createContact(app, owner, {
      kind: "individual",
      name: "Maria Chen",
      email: "maria@example.test",
      position: "Sales",
      organizationName: "Oceanic Supplies",
      attributes: { language: "en" },
    });
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: ContactView }).data;
    expect(data.kind).toBe("individual");
    expect(data.position).toBe("Sales");
    expect(data.organizationId).toBeTruthy();
    expect(data.organizationName).toBe("Oceanic Supplies");
    expect(data.attributes).toEqual({ language: "en" });

    // The inline organization is now listed too.
    const orgs = await app.request("/contacts?kind=organization", { headers: { "x-uid": owner } });
    expect(((await orgs.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["Oceanic Supplies"]);
  });

  test("POST /contacts accepts the shared email/website on an organization and website/address/taxId on an individual", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    const org = await createContact(app, owner, {
      kind: "organization",
      name: "Shared Org",
      email: "info@shared-org.test",
      website: "shared-org.test",
      taxId: "SO-1",
      address: "Dock 9",
    });
    expect(org.status).toBe(201);
    const orgData = ((await org.json()) as { data: ContactView }).data;
    expect(orgData.email).toBe("info@shared-org.test");
    expect(orgData.website).toBe("shared-org.test");

    const person = await createContact(app, owner, {
      kind: "individual",
      name: "Shared Person",
      website: "shared-person.test",
      address: "Pier 3",
      taxId: "SP-1",
    });
    expect(person.status).toBe(201);
    const personData = ((await person.json()) as { data: ContactView }).data;
    expect(personData.website).toBe("shared-person.test");
    expect(personData.address).toBe("Pier 3");
    expect(personData.taxId).toBe("SP-1");
  });

  test("POST /contacts drops person-only fields from an organization body (schema omits them)", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    // The organization body schema has no position/organizationName fields, so
    // zod strips them rather than rejecting; the org is created without them.
    const res = await app.request("/contacts", jsonReq(owner, "POST", {
      kind: "organization",
      name: "Stripped Org",
      phone: "1",
      position: "CEO",
      organizationName: "Parent",
    }));
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: ContactView }).data;
    expect(data.kind).toBe("organization");
    expect(data.position).toBeNull();
    expect(data.organizationId).toBeNull();
  });

  test("POST /contacts creates an inline organization from organizationAttributes and embeds its summary", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    const res = await createContact(app, owner, {
      kind: "individual",
      name: "Dana Reed",
      organizationName: "Reed Holdings",
      organizationAttributes: {
        website: "reed-holdings.test",
        email: "hi@reed-holdings.test",
        phone: "+1 555 1212",
        address: "Suite 100",
        taxId: "RH-1",
      },
    });
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: ContactView }).data;
    expect(data.organizationId).toBeTruthy();
    expect(data.organization).toMatchObject({
      name: "Reed Holdings",
      website: "reed-holdings.test",
      email: "hi@reed-holdings.test",
      phone: "+1 555 1212",
      address: "Suite 100",
      taxId: "RH-1",
    });
  });

  test("POST /contacts requires a valid kind discriminator", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    const missing = await app.request("/contacts", jsonReq(owner, "POST", { name: "No Kind" }));
    expect(missing.status).toBe(422);

    const invalid = await app.request("/contacts", jsonReq(owner, "POST", { kind: "robot", name: "Bad Kind" }));
    expect(invalid.status).toBe(422);
  });

  test("POST /contacts requires a phone or email (name alone is rejected)", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");

    // Valid kind + name but no reachable channel → rejected by the refine.
    const nameOnly = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "No Method Co" }));
    expect(nameOnly.status).toBe(422);

    // A whitespace-only phone still counts as missing (zod trims before the refine).
    const blank = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "Blank Co", phone: "   " }));
    expect(blank.status).toBe(422);

    // Either channel alone satisfies the rule.
    const withPhone = await app.request("/contacts", jsonReq(owner, "POST", { kind: "organization", name: "Phone Co", phone: "123" }));
    expect(withPhone.status).toBe(201);
    const withEmail = await app.request("/contacts", jsonReq(owner, "POST", { kind: "individual", name: "Email Person", email: "e@example.test" }));
    expect(withEmail.status).toBe(201);
  });

  test("GET /contacts filters by kind", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    await createContact(app, owner, { kind: "individual", name: "A Person" });
    await createContact(app, owner, { kind: "organization", name: "An Org" });

    const people = await app.request("/contacts?kind=individual", { headers: { "x-uid": owner } });
    expect(((await people.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["A Person"]);
    const orgs = await app.request("/contacts?kind=organization", { headers: { "x-uid": owner } });
    expect(((await orgs.json()) as { data: ContactView[] }).data.map(c => c.name)).toEqual(["An Org"]);
  });

  test("POST then DELETE /contacts/:id/avatar sets and clears the avatar", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const created = await createdContact(app, owner, { name: "Logo Co" });
    expect(created.avatarUrl).toBeNull();

    const form = new FormData();
    form.set("file", pngFile());
    const set = await app.request(`/contacts/${created.id}/avatar`, { method: "POST", headers: { "x-uid": owner }, body: form });
    expect(set.status).toBe(200);
    const setData = ((await set.json()) as { data: ContactView }).data;
    expect(setData.avatarReferenceId).toBeTruthy();
    expect(setData.avatarUrl).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);

    const removed = await app.request(`/contacts/${created.id}/avatar`, { method: "DELETE", headers: { "x-uid": owner } });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { data: ContactView }).data.avatarReferenceId).toBeNull();
  });

  test("avatar upload is forbidden for a stranger and rejects non-images", async () => {
    const app = buildContactApp();
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const created = await createdContact(app, owner, { name: "Guarded Co", visibility: "public" });

    const form = new FormData();
    form.set("file", pngFile());
    const denied = await app.request(`/contacts/${created.id}/avatar`, { method: "POST", headers: { "x-uid": stranger }, body: form });
    expect(denied.status).toBe(403);

    const badForm = new FormData();
    badForm.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    const badType = await app.request(`/contacts/${created.id}/avatar`, { method: "POST", headers: { "x-uid": owner }, body: badForm });
    expect(badType.status).toBe(400);
  });

  test("protected route registration exposes contact routes", async () => {
    // The full protected router includes the module gate; module visibility
    // is granted through groups (FEAT-032), so the non-admin needs membership
    // in a group granting `contacts`.
    const group = await createGroup(db, { name: "Contacts only", modules: ["contacts"] });
    const app = buildProtectedApp();
    const user = await seedUser("user-a");
    await addGroupMember(db, group.id, user);

    const res = await app.request("/contacts", { headers: { "x-uid": user } });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });
});

function buildContactApp(): Hono<AppEnv> {
  const app = buildBaseApp();
  app.use("*", policyMiddleware({ basePath: "" }));
  app.route("/", contactRoutes());
  app.onError(errorHandler);
  return app;
}

function buildProtectedApp(): Hono<AppEnv> {
  const app = buildBaseApp();
  app.use("*", policyMiddleware({ basePath: "" }));
  app.route("/", protectedRoutes());
  app.onError(errorHandler);
  return app;
}

function buildBaseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", stubLogger);
    c.set("requestId", "test");
    const uid = c.req.header("x-uid");
    if (uid) {
      const user = await db.select().from(users).where(eq(users.id, uid)).get();
      if (user)
        c.set("user", user);
    }
    await next();
  });
  return app;
}

async function seedUser(id: string, role: "admin" | "user" = "user"): Promise<string> {
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@test.local`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

function jsonReq(userId: string, method: string, body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json", "x-uid": userId },
    body: JSON.stringify(body),
  };
}

// Default to an organization (the common case + supplier path); individual
// tests pass `kind: "individual"` explicitly to exercise person-only fields.
// A contact now requires a phone or email, so default a phone when the test
// doesn't supply a reachable channel (mirrors the default `kind`).
function createContact(app: Hono<AppEnv>, userId: string, body: Record<string, unknown>) {
  const hasMethod = body.phone != null || body.email != null;
  return app.request("/contacts", jsonReq(userId, "POST", {
    kind: "organization",
    ...(hasMethod ? {} : { phone: "000" }),
    ...body,
  }));
}

async function createdContact(app: Hono<AppEnv>, userId: string, body: Record<string, unknown>): Promise<ContactView> {
  const res = await createContact(app, userId, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: ContactView }).data;
}

function pngFile(name = "avatar.png"): File {
  return new File([PNG_1X1], name, { type: "image/png" });
}

interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly website: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
}

interface ContactView {
  readonly id: string;
  readonly kind: string;
  readonly ownerId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly position: string | null;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly organization: OrganizationSummary | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly note: string | null;
  readonly attributes: Record<string, string> | null;
  readonly avatarReferenceId: string | null;
  readonly avatarUrl: string | null;
  readonly status: string | null;
  readonly visibility: string;
  readonly confidential: boolean;
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  readonly canManage: boolean;
}
