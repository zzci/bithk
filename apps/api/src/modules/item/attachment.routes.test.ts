import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { ProtectedEnv, User } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { auditEvents } from "@/modules/audit/schema";
import { uploadDriveFile } from "@/modules/drive/drive.service";
import { fileReferences } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __clearPendingUploadsForTests } from "@/modules/file/storage/pending-uploads";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver, setActiveUploadDriver } from "@/modules/file/storage/registry";
import { mountItemAttachmentRoutes } from "@/modules/item/attachment.routes";
import { createItem } from "@/modules/item/item.service";
import { errorHandler } from "@/shared/middleware/error-handler";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

// The acting user is chosen by the `x-test-user` header. The permission
// callback maps them onto the three capability tiers the factory consumes:
// outsider (no read), reader (read only), writer (read + write); `admin`
// carries the role every host's `canDelete` bypasses on.
const WRITER = { id: "writer", role: "user", name: "Writer" };
const READER = { id: "reader", role: "user", name: "Reader" };
const OUTSIDER = { id: "outsider", role: "user", name: "Outsider" };
const ADMIN = { id: "admin", role: "admin", name: "Admin" };
const ACTORS: Record<string, typeof WRITER> = { writer: WRITER, reader: READER, outsider: OUTSIDER, admin: ADMIN };

let db: AppDatabase;
let dbPath: string;
let thingExternalId: string;
let otherThingExternalId: string;
let thingOwnerId: string;
let otherThingOwnerId: string;
let recordExternalId: string;
let recordOwnerId: string;

function config(): Config {
  return {
    NODE_ENV: "test",
    MAX_UPLOAD_BYTES: 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_GC_MODE: "sync",
    FILE_PRESIGN_ENABLED: false,
    FILE_PRESIGN_TTL_SECONDS: 300,
  } as unknown as Config;
}

async function sharedPermissions(_db: AppDatabase, user: { id: string; role: string }) {
  const isKnown = user.id !== OUTSIDER.id;
  return {
    canRead: isKnown,
    canWrite: user.id === WRITER.id || user.role === "admin",
    canDelete: (createdBy: string) => user.role === "admin" || createdBy === user.id,
  };
}

/**
 * Mount the factory twice: `/things` with the defaults (403 write denial,
 * audit on) and `/records` in the procurement/hr style (`writeDenial:
 * "not-found"`, audit off, custom owner type).
 */
function buildApp(): Hono<ProtectedEnv> {
  const app = new Hono<ProtectedEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", config());
    c.set("logger", stubLogger);
    const user = ACTORS[c.req.header("x-test-user") ?? "outsider"] ?? OUTSIDER;
    // The factory only reads id/role/name; a partial actor is sufficient.
    c.set("user", user as unknown as User);
    await next();
  });

  mountItemAttachmentRoutes(app, {
    routePrefix: "/things",
    resourceType: "thing",
    tag: "things",
    summaries: {
      upload: "Upload a thing attachment",
      fromDrive: "Attach a drive file to a thing",
      list: "List thing attachments",
      download: "Download a thing attachment",
      delete: "Delete a thing attachment",
    },
    async resolve(_db, idParam) {
      if (idParam === thingExternalId)
        return { ownerId: thingOwnerId, resource: {}, externalId: idParam, resourceName: "thing subject" };
      if (idParam === otherThingExternalId)
        return { ownerId: otherThingOwnerId, resource: {}, externalId: idParam, resourceName: "other thing" };
      return null;
    },
    permissions: sharedPermissions,
  });

  mountItemAttachmentRoutes(app, {
    routePrefix: "/records",
    resourceType: "record",
    tag: "records",
    ownerType: "custom_record_doc",
    writeDenial: "not-found",
    auditEnabled: false,
    summaries: {
      upload: "Upload a record document",
      fromDrive: "Attach a drive file as a record document",
      list: "List record documents",
      download: "Download a record document",
      delete: "Delete a record document",
    },
    async resolve(_db, idParam) {
      if (idParam !== recordExternalId)
        return null;
      return { ownerId: recordOwnerId, resource: {}, externalId: idParam, resourceName: "record subject" };
    },
    permissions: sharedPermissions,
  });

  app.onError(errorHandler);
  return app;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-attachment-routes-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  await db.insert(users).values({
    id: WRITER.id,
    oauthSub: "sub-writer",
    username: "writer",
    name: "Writer",
    email: "writer@test.com",
  }).run();
  const thing = await createItem(db, { type: "issue", title: "Subject", status: "todo", creatorId: WRITER.id });
  thingOwnerId = thing.id;
  const otherThing = await createItem(db, { type: "issue", title: "Other", status: "todo", creatorId: WRITER.id });
  otherThingOwnerId = otherThing.id;
  thingExternalId = nanoid();
  otherThingExternalId = nanoid();
  recordExternalId = nanoid();
  recordOwnerId = nanoid();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

function uploadReq(user: string, name = "note.txt", body = "attachment-bytes"): RequestInit {
  const form = new FormData();
  form.append("file", new File([body], name, { type: "text/plain" }));
  return { method: "POST", headers: { "x-test-user": user }, body: form };
}

function req(app: Hono<ProtectedEnv>, method: string, path: string, user: string, body?: unknown) {
  const headers: Record<string, string> = { "x-test-user": user };
  if (body !== undefined)
    headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function uploadAs(app: Hono<ProtectedEnv>, base: string, user: string): Promise<string> {
  const res = await app.request(`${base}/attachments`, uploadReq(user));
  expect(res.status).toBe(201);
  return (await res.json() as { data: { id: string } }).data.id;
}

describe("shared attachment routes — permission callback", () => {
  const thingBase = () => `/things/${thingExternalId}`;
  const recordBase = () => `/records/${recordExternalId}`;

  test("no read access is a fail-closed 404 (not 403) on every route", async () => {
    const app = buildApp();
    for (const [method, path, body] of [
      ["GET", `${thingBase()}/attachments`, undefined],
      ["GET", `${thingBase()}/attachments/some-aid`, undefined],
      ["DELETE", `${thingBase()}/attachments/some-aid`, undefined],
      ["POST", `${thingBase()}/attachments/from-drive`, { entryId: "x" }],
    ] as const) {
      const res = await req(app, method, path, "outsider", body);
      expect(res.status).toBe(404);
    }
    const up = await app.request(`${thingBase()}/attachments`, uploadReq("outsider"));
    expect(up.status).toBe(404);
  });

  test("missing subject is a 404 even for a writer", async () => {
    const res = await req(buildApp(), "GET", "/things/does-not-exist/attachments", "writer");
    expect(res.status).toBe(404);
  });

  test("writeDenial default: a reader's upload is a 403", async () => {
    const res = await buildApp().request(`${thingBase()}/attachments`, uploadReq("reader"));
    expect(res.status).toBe(403);
  });

  test("writeDenial not-found: a reader's upload is a 404", async () => {
    const res = await buildApp().request(`${recordBase()}/attachments`, uploadReq("reader"));
    expect(res.status).toBe(404);
  });

  test("writer round-trip: upload 201, list, download bytes, delete own", async () => {
    const app = buildApp();
    const aid = await uploadAs(app, thingBase(), "writer");

    const listed = await req(app, "GET", `${thingBase()}/attachments`, "reader");
    expect(listed.status).toBe(200);
    expect((await listed.json() as { data: { id: string }[] }).data.map(a => a.id)).toEqual([aid]);

    const dl = await req(app, "GET", `${thingBase()}/attachments/${aid}`, "reader");
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe("attachment-bytes");

    const del = await req(app, "DELETE", `${thingBase()}/attachments/${aid}`, "writer");
    expect(del.status).toBe(200);
    const after = await req(app, "GET", `${thingBase()}/attachments`, "writer");
    expect((await after.json() as { data: unknown[] }).data).toEqual([]);
  });

  test("delete: a reader who is not the uploader gets 403; an admin may delete", async () => {
    const app = buildApp();
    const aid = await uploadAs(app, thingBase(), "writer");

    const denied = await req(app, "DELETE", `${thingBase()}/attachments/${aid}`, "reader");
    expect(denied.status).toBe(403);

    const byAdmin = await req(app, "DELETE", `${thingBase()}/attachments/${aid}`, "admin");
    expect(byAdmin.status).toBe(200);
  });

  test("an attachment id under a different subject of the same host is a 404", async () => {
    const app = buildApp();
    const aid = await uploadAs(app, thingBase(), "writer");
    const res = await req(app, "GET", `/things/${otherThingExternalId}/attachments/${aid}`, "writer");
    expect(res.status).toBe(404);
  });

  test("audit on by default: upload emits <resourceType>.attachment_uploaded", async () => {
    const app = buildApp();
    await uploadAs(app, thingBase(), "writer");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "thing.attachment_uploaded")).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.resourceId).toBe(thingExternalId);
    expect(events[0]!.resourceName).toBe("thing subject");
  });

  test("auditEnabled false: upload and delete emit no audit rows", async () => {
    const app = buildApp();
    const aid = await uploadAs(app, recordBase(), "writer");
    await req(app, "DELETE", `${recordBase()}/attachments/${aid}`, "writer");
    const events = await db.select().from(auditEvents).all();
    expect(events).toEqual([]);
  });

  test("ownerType override: references are registered under the host's discriminator", async () => {
    const app = buildApp();
    const aid = await uploadAs(app, recordBase(), "writer");
    const ref = (await db.select().from(fileReferences).where(eq(fileReferences.id, aid)).get())!;
    expect(ref.ownerType).toBe("custom_record_doc");
    expect(ref.ownerId).toBe(recordOwnerId);
  });
});

describe("shared attachment routes — presigned direct upload (FEAT-050)", () => {
  const thingBase = () => `/things/${thingExternalId}`;
  const sha = (c: string): string => c.repeat(64).slice(0, 64);
  const presignBody = (c: string) => ({ filename: "direct.bin", sha256: sha(c), size: 512, mimetype: "application/octet-stream" });
  const confirmBody = (c: string) => ({ filename: "direct.bin", sha256: sha(c), mimetype: "application/octet-stream" });

  // Minimal in-memory object store standing in for S3 (presignUpload + stat).
  const store = new Map<string, number>();
  function fakeS3() {
    return {
      name: "s3",
      async put(key: string, data: ArrayBufferLike) {
        store.set(key, data.byteLength);
      },
      async getStream() {
        return new ReadableStream({ start: c => c.close() });
      },
      async delete(key: string) {
        store.delete(key);
      },
      async exists(key: string) {
        return store.has(key);
      },
      async presignUpload(key: string, opts: { contentType: string }) {
        return { url: `https://s3.test/${key}`, method: "PUT" as const, headers: { "Content-Type": opts.contentType } };
      },
      async stat(key: string) {
        const size = store.get(key);
        return size === undefined ? null : { size };
      },
    };
  }

  function useFakeS3(): void {
    store.clear();
    __clearPendingUploadsForTests();
    registerDriver(fakeS3());
    setActiveUploadDriver("s3");
  }

  test("409 DIRECT_UPLOAD_UNAVAILABLE when the active upload driver cannot presign (local)", async () => {
    const res = await req(buildApp(), "POST", `${thingBase()}/attachments/presign-upload`, "writer", presignBody("a"));
    expect(res.status).toBe(409);
  });

  test("authorization mirrors the multipart route: reader 403, outsider fail-closed 404", async () => {
    useFakeS3();
    const app = buildApp();
    expect((await req(app, "POST", `${thingBase()}/attachments/presign-upload`, "reader", presignBody("a"))).status).toBe(403);
    expect((await req(app, "POST", `${thingBase()}/attachments/presign-upload`, "outsider", presignBody("a"))).status).toBe(404);
    expect((await req(app, "POST", `${thingBase()}/attachments/confirm-upload`, "reader", confirmBody("a"))).status).toBe(403);
    // writeDenial "not-found" hosts mask the 403 as a 404.
    expect((await req(app, "POST", `/records/${recordExternalId}/attachments/presign-upload`, "reader", presignBody("a"))).status).toBe(404);
  });

  test("full flow: presign → PUT → confirm registers the reference and audits once", async () => {
    useFakeS3();
    const app = buildApp();

    const presign = await req(app, "POST", `${thingBase()}/attachments/presign-upload`, "writer", presignBody("b"));
    expect(presign.status).toBe(200);
    const { data } = await presign.json() as { data: { mode: "upload"; upload: { url: string; method: string } } };
    expect(data.mode).toBe("upload");
    const key = data.upload.url.slice("https://s3.test/".length);
    expect(key).toMatch(/^\d{10}\/[0-9a-hjkmnp-tv-z]{26}$/);
    store.set(key, 512); // the browser PUT

    const confirm = await req(app, "POST", `${thingBase()}/attachments/confirm-upload`, "writer", confirmBody("b"));
    expect(confirm.status).toBe(201);
    const view = (await confirm.json() as { data: { id: string; ownerType: string; size: number } }).data;
    expect(view.ownerType).toBe("item_attachment");
    expect(view.size).toBe(512);

    const ref = (await db.select().from(fileReferences).where(eq(fileReferences.id, view.id)).get())!;
    expect(ref.ownerId).toBe(thingOwnerId);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "thing.attachment_uploaded")).all();
    expect(events).toHaveLength(1);
  });

  test("presign dedups instantly for the same uploader (mode done, no second upload)", async () => {
    useFakeS3();
    const app = buildApp();
    const presign = await req(app, "POST", `${thingBase()}/attachments/presign-upload`, "writer", presignBody("c"));
    const { data } = await presign.json() as { data: { mode: string; upload: { url: string } } };
    store.set(data.upload.url.slice("https://s3.test/".length), 512);
    await req(app, "POST", `${thingBase()}/attachments/confirm-upload`, "writer", confirmBody("c"));

    // Same content, same user, other subject: finishes without an upload.
    const again = await req(app, "POST", `/things/${otherThingExternalId}/attachments/presign-upload`, "writer", presignBody("c"));
    expect(again.status).toBe(201);
    const done = (await again.json() as { data: { mode: string; attachment: { ownerId: string } } }).data;
    expect(done.mode).toBe("done");
    expect(done.attachment.ownerId).toBe(otherThingOwnerId);
  });

  test("confirm without a landed object is a 400 UPLOAD_NOT_FOUND", async () => {
    useFakeS3();
    const app = buildApp();
    await req(app, "POST", `${thingBase()}/attachments/presign-upload`, "writer", presignBody("d"));
    const res = await req(app, "POST", `${thingBase()}/attachments/confirm-upload`, "writer", confirmBody("d"));
    expect(res.status).toBe(400);
  });
});

describe("shared attachment routes — drive READ re-assertion on from-drive", () => {
  const thingBase = () => `/things/${thingExternalId}`;

  test("a writer attaches their own drive entry: 201, reference under the host owner", async () => {
    const app = buildApp();
    const entry = await uploadDriveFile(db, config(), {
      ownerType: "user",
      ownerId: WRITER.id,
      createdBy: WRITER.id,
      file: new File(["drive-bytes"], "report.txt", { type: "text/plain" }),
    });
    const res = await req(app, "POST", `${thingBase()}/attachments/from-drive`, "writer", { entryId: entry.id });
    expect(res.status).toBe(201);
    const view = (await res.json() as { data: { ownerType: string; filename: string } }).data;
    expect(view.ownerType).toBe("item_attachment");
    expect(view.filename).toBe("report.txt");
  });

  test("a drive entry the actor cannot read is rejected (403/404), no reference added", async () => {
    const app = buildApp();
    // `files.uploaded_by` FKs users, so the foreign uploader must exist.
    await db.insert(users).values({
      id: OUTSIDER.id,
      oauthSub: "sub-outsider",
      username: "outsider",
      name: "Outsider",
      email: "outsider@test.com",
    }).run();
    const entry = await uploadDriveFile(db, config(), {
      ownerType: "user",
      ownerId: OUTSIDER.id,
      createdBy: OUTSIDER.id,
      file: new File(["secret"], "secret.txt", { type: "text/plain" }),
    });
    const res = await req(app, "POST", `${thingBase()}/attachments/from-drive`, "writer", { entryId: entry.id });
    expect([403, 404]).toContain(res.status);
    const refs = await db.select().from(fileReferences).where(eq(fileReferences.ownerType, "item_attachment")).all();
    expect(refs).toEqual([]);
  });
});
